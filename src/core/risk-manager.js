/**
 * Risk Manager
 * Handles risk controls, position limits, and kill switch
 */

const polyClient = require('./polymarket-client');
const db = require('../database');

/**
 * Pre-trade risk checks
 */
async function canTrade(opportunity) {
  const settings = db.settings.get();

  // Check 1: Kill switch
  if (settings.kill_switch) {
    return { allowed: false, reason: 'Kill switch is active' };
  }

  // Check 2: Auto mode (if in manual mode, trades need approval)
  // This check is done at a higher level, not here

  // Check 3: Daily loss limit
  const todayPnL = db.pnl.getToday();
  if (todayPnL && todayPnL.realized_pnl < -settings.daily_loss_limit) {
    // Auto-activate kill switch
    await activateKillSwitch('Daily loss limit exceeded', null);
    return { allowed: false, reason: 'Daily loss limit exceeded' };
  }

  // Check 4: Position limits
  const openPositions = db.trades.countOpen();
  if (openPositions >= settings.max_open_positions) {
    return { allowed: false, reason: `Maximum open positions reached (${openPositions}/${settings.max_open_positions})` };
  }

  // Check 5: Balance check
  const balance = await polyClient.getBalance();
  if (balance.balance < settings.position_size) {
    return { allowed: false, reason: `Insufficient balance: $${balance.balance.toFixed(2)} < $${settings.position_size}` };
  }

  // Check 6: Profit threshold
  if (opportunity.spread < settings.profit_threshold) {
    return { allowed: false, reason: `Below profit threshold: ${(opportunity.spread * 100).toFixed(2)}% < ${(settings.profit_threshold * 100).toFixed(2)}%` };
  }

  // Check 7: Minimum liquidity (at least 2x position size on each side)
  const minLiquidity = settings.position_size * 2;
  if (opportunity.yes_liquidity < minLiquidity || opportunity.no_liquidity < minLiquidity) {
    return { allowed: false, reason: 'Insufficient liquidity' };
  }

  return { allowed: true };
}

/**
 * Activate kill switch
 * Stops all trading and cancels all open orders
 */
async function activateKillSwitch(reason, emitter) {
  console.log('[RiskManager] KILL SWITCH ACTIVATED:', reason);

  // Update settings
  db.settings.update({ kill_switch: true });

  // Cancel all open orders
  try {
    await polyClient.cancelAllOrders();
    console.log('[RiskManager] All orders cancelled');
  } catch (error) {
    console.error('[RiskManager] Failed to cancel all orders:', error.message);
  }

  // Clear pending approvals
  db.pending.deleteAll();

  // Create critical alert
  db.alerts.create({
    type: 'kill_switch',
    severity: 'critical',
    message: `KILL SWITCH ACTIVATED: ${reason}`,
    data: { reason, timestamp: new Date().toISOString() }
  });

  // Emit event
  if (emitter) {
    emitter.emit('kill_switch:activated', { reason });
  }

  return true;
}

/**
 * Deactivate kill switch
 */
async function deactivateKillSwitch(emitter) {
  console.log('[RiskManager] Kill switch deactivated');

  db.settings.update({ kill_switch: false });

  db.alerts.create({
    type: 'kill_switch',
    severity: 'info',
    message: 'Kill switch deactivated - trading resumed'
  });

  if (emitter) {
    emitter.emit('kill_switch:deactivated');
  }

  return true;
}

/**
 * Toggle kill switch
 */
async function toggleKillSwitch(emitter) {
  const settings = db.settings.get();

  if (settings.kill_switch) {
    return await deactivateKillSwitch(emitter);
  } else {
    return await activateKillSwitch('Manual activation', emitter);
  }
}

/**
 * Get current risk status
 */
async function getRiskStatus() {
  const settings = db.settings.get();
  const todayPnL = db.pnl.getToday();
  const openPositions = db.trades.countOpen();
  const balance = await polyClient.getBalance();

  const dailyPnL = todayPnL?.realized_pnl || 0;
  const lossLimitRemaining = settings.daily_loss_limit + dailyPnL;

  return {
    kill_switch: settings.kill_switch,
    auto_mode: settings.auto_mode,
    balance: balance.balance,
    open_positions: openPositions,
    max_positions: settings.max_open_positions,
    daily_pnl: dailyPnL,
    daily_loss_limit: settings.daily_loss_limit,
    loss_limit_remaining: lossLimitRemaining,
    position_size: settings.position_size,
    can_trade: !settings.kill_switch &&
               openPositions < settings.max_open_positions &&
               balance.balance >= settings.position_size &&
               lossLimitRemaining > 0
  };
}

/**
 * Check if we should auto-trigger kill switch based on conditions
 */
async function checkRiskConditions(emitter) {
  const status = await getRiskStatus();

  // Already triggered
  if (status.kill_switch) return false;

  // Check loss limit
  if (status.loss_limit_remaining <= 0) {
    await activateKillSwitch('Daily loss limit exceeded', emitter);
    return true;
  }

  // Check balance
  if (status.balance < status.position_size * 0.5) {
    await activateKillSwitch('Low balance warning', emitter);
    return true;
  }

  return false;
}

module.exports = {
  canTrade,
  activateKillSwitch,
  deactivateKillSwitch,
  toggleKillSwitch,
  getRiskStatus,
  checkRiskConditions
};
