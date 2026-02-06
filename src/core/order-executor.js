/**
 * Order Executor
 * Handles order placement and trade lifecycle
 */

const polyClient = require('./polymarket-client');
const db = require('../database');

/**
 * Execute an arbitrage trade
 * Places limit buy orders on both YES and NO outcomes
 */
async function executeTrade(opportunity, emitter) {
  const settings = db.settings.get();
  const positionSize = settings.position_size;

  // Calculate number of shares to buy
  const totalCost = opportunity.yes_price + opportunity.no_price;
  const shares = positionSize / totalCost;

  console.log(`[Executor] Executing trade for: ${opportunity.market_question?.substring(0, 50)}...`);
  console.log(`[Executor] YES: ${opportunity.yes_price}, NO: ${opportunity.no_price}, Shares: ${shares.toFixed(4)}`);

  // Create trade record first
  const trade = db.trades.create({
    market_id: opportunity.market_id,
    market_question: opportunity.market_question,
    yes_token_id: opportunity.yes_token_id,
    no_token_id: opportunity.no_token_id,
    yes_price: opportunity.yes_price,
    no_price: opportunity.no_price,
    total_cost: totalCost,
    position_size: positionSize,
    expected_profit: opportunity.expected_profit,
    status: 'pending'
  });

  let yesOrder = null;
  let noOrder = null;

  try {
    // Place YES order
    console.log('[Executor] Placing YES order...');
    yesOrder = await polyClient.placeOrder({
      tokenId: opportunity.yes_token_id,
      price: opportunity.yes_price,
      size: shares,
      side: 'BUY'
    });

    // Update trade with YES order ID
    db.trades.update(trade.id, {
      yes_order_id: yesOrder.orderID || yesOrder.order_id
    });

    // Place NO order
    console.log('[Executor] Placing NO order...');
    noOrder = await polyClient.placeOrder({
      tokenId: opportunity.no_token_id,
      price: opportunity.no_price,
      size: shares,
      side: 'BUY'
    });

    // Update trade with NO order ID and status
    const updatedTrade = db.trades.update(trade.id, {
      no_order_id: noOrder.orderID || noOrder.order_id,
      status: 'placed'
    });

    console.log('[Executor] Trade placed successfully:', trade.id);

    // Create alert
    db.alerts.create({
      type: 'trade',
      severity: 'info',
      message: `Trade placed: ${opportunity.market_question?.substring(0, 50)}...`,
      data: { trade_id: trade.id, spread: opportunity.spread }
    });

    // Emit event
    if (emitter) {
      emitter.emit('trade:created', updatedTrade);
    }

    return { success: true, trade: updatedTrade, yesOrder, noOrder };

  } catch (error) {
    console.error('[Executor] Trade failed:', error.message);

    // Rollback: cancel any placed orders
    await rollbackTrade(trade, yesOrder, noOrder);

    // Update trade status
    db.trades.update(trade.id, { status: 'failed' });

    // Create error alert
    db.alerts.create({
      type: 'error',
      severity: 'error',
      message: `Trade failed: ${error.message}`,
      data: { trade_id: trade.id, error: error.message }
    });

    return { success: false, error: error.message, trade };
  }
}

/**
 * Rollback a failed trade by cancelling any placed orders
 */
async function rollbackTrade(trade, yesOrder, noOrder) {
  console.log('[Executor] Rolling back trade:', trade.id);

  try {
    if (yesOrder && (yesOrder.orderID || yesOrder.order_id)) {
      await polyClient.cancelOrder(yesOrder.orderID || yesOrder.order_id);
    }
  } catch (e) {
    console.error('[Executor] Failed to cancel YES order:', e.message);
  }

  try {
    if (noOrder && (noOrder.orderID || noOrder.order_id)) {
      await polyClient.cancelOrder(noOrder.orderID || noOrder.order_id);
    }
  } catch (e) {
    console.error('[Executor] Failed to cancel NO order:', e.message);
  }
}

/**
 * Cancel a trade's orders
 */
async function cancelTrade(tradeId, emitter) {
  const trade = db.trades.getById(tradeId);
  if (!trade) {
    return { success: false, error: 'Trade not found' };
  }

  console.log('[Executor] Cancelling trade:', tradeId);

  let cancelledYes = false;
  let cancelledNo = false;

  if (trade.yes_order_id) {
    cancelledYes = await polyClient.cancelOrder(trade.yes_order_id);
  }

  if (trade.no_order_id) {
    cancelledNo = await polyClient.cancelOrder(trade.no_order_id);
  }

  const updatedTrade = db.trades.update(tradeId, { status: 'cancelled' });

  db.alerts.create({
    type: 'trade',
    severity: 'warning',
    message: `Trade cancelled: ${trade.market_question?.substring(0, 50)}...`,
    data: { trade_id: tradeId }
  });

  if (emitter) {
    emitter.emit('trade:cancelled', updatedTrade);
  }

  return { success: true, trade: updatedTrade, cancelledYes, cancelledNo };
}

/**
 * Check order status and update trade
 */
async function checkOrderStatus(trade) {
  let yesStatus = null;
  let noStatus = null;

  if (trade.yes_order_id) {
    const order = await polyClient.getOrder(trade.yes_order_id);
    if (order) {
      yesStatus = order.status;
    }
  }

  if (trade.no_order_id) {
    const order = await polyClient.getOrder(trade.no_order_id);
    if (order) {
      noStatus = order.status;
    }
  }

  // Determine overall trade status
  let newStatus = trade.status;

  if (yesStatus === 'MATCHED' && noStatus === 'MATCHED') {
    newStatus = 'filled';
  } else if (yesStatus === 'MATCHED' || noStatus === 'MATCHED') {
    newStatus = 'partial';
  } else if (yesStatus === 'CANCELLED' || noStatus === 'CANCELLED') {
    newStatus = 'cancelled';
  }

  if (newStatus !== trade.status) {
    db.trades.update(trade.id, { status: newStatus });
    console.log(`[Executor] Trade ${trade.id} status updated: ${trade.status} -> ${newStatus}`);
  }

  return { yesStatus, noStatus, newStatus };
}

/**
 * Process settlement for a trade
 */
async function processSettlement(trade, result, emitter) {
  const profit = trade.position_size - trade.total_cost * (trade.position_size / trade.total_cost);
  // Actual profit calculation: we spent total_cost per share, we get $1 back
  const shares = trade.position_size / trade.total_cost;
  const actualProfit = shares * (1 - trade.total_cost);

  const updatedTrade = db.trades.update(trade.id, {
    status: 'settled',
    settlement_result: result,
    actual_profit: actualProfit,
    settled_at: new Date().toISOString()
  });

  // Update daily P&L
  const today = new Date().toISOString().split('T')[0];
  db.pnl.incrementTrades(today, actualProfit);

  db.alerts.create({
    type: 'settlement',
    severity: 'info',
    message: `Trade settled: ${result}, Profit: $${actualProfit.toFixed(4)}`,
    data: { trade_id: trade.id, result, profit: actualProfit }
  });

  if (emitter) {
    emitter.emit('trade:settled', { trade: updatedTrade, profit: actualProfit });
  }

  return updatedTrade;
}

module.exports = {
  executeTrade,
  cancelTrade,
  checkOrderStatus,
  processSettlement,
  rollbackTrade
};
