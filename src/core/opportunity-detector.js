/**
 * Opportunity Detector
 * Detects arbitrage opportunities in 15-minute crypto markets
 */

const polyClient = require('./polymarket-client');
const db = require('../database');
const config = require('../config');

/**
 * Calculate liquidity from order book side
 */
function calculateLiquidity(orders, levels = 5) {
  if (!orders || orders.length === 0) return 0;

  return orders.slice(0, levels).reduce((total, order) => {
    const price = parseFloat(order.price);
    const size = parseFloat(order.size);
    return total + (price * size);
  }, 0);
}

/**
 * Get best price from order book
 */
function getBestPrice(orders, side) {
  if (!orders || orders.length === 0) return null;

  // For buying: we want best ask (lowest price to buy at)
  // For selling: we want best bid (highest price to sell at)
  // Asks are sorted ascending, bids descending
  return parseFloat(orders[0].price);
}

/**
 * Analyze a market for arbitrage opportunity
 */
async function analyzeMarket(market) {
  const settings = db.settings.get();
  const threshold = settings.profit_threshold;
  const positionSize = settings.position_size;

  try {
    // Fetch order books for both YES and NO tokens
    const [yesBook, noBook] = await Promise.all([
      polyClient.getOrderBook(market.yesTokenId),
      polyClient.getOrderBook(market.noTokenId)
    ]);

    // Get best ask prices (we're buying both YES and NO)
    const yesBestAsk = getBestPrice(yesBook.asks, 'BUY');
    const noBestAsk = getBestPrice(noBook.asks, 'BUY');

    if (!yesBestAsk || !noBestAsk) {
      return null; // No liquidity on one side
    }

    // Calculate total cost and spread
    const totalCost = yesBestAsk + noBestAsk;
    const spread = 1 - totalCost;

    // Check if profitable enough
    if (spread < threshold) {
      return null; // Not enough profit
    }

    // Calculate liquidity
    const yesLiquidity = calculateLiquidity(yesBook.asks);
    const noLiquidity = calculateLiquidity(noBook.asks);

    // Calculate expected profit
    const shares = positionSize / totalCost;
    const expectedProfit = shares * spread;

    // Save order book snapshot
    saveSnapshot(market.conditionId, market.yesTokenId, 'YES', yesBook);
    saveSnapshot(market.conditionId, market.noTokenId, 'NO', noBook);

    return {
      market_id: market.conditionId,
      market_question: market.question,
      yes_token_id: market.yesTokenId,
      no_token_id: market.noTokenId,
      yes_price: yesBestAsk,
      no_price: noBestAsk,
      total_cost: totalCost,
      spread: spread,
      expected_profit: expectedProfit,
      yes_liquidity: yesLiquidity,
      no_liquidity: noLiquidity,
      expires_at: market.endDate,
      yes_book: {
        best_bid: getBestPrice(yesBook.bids, 'SELL'),
        best_ask: yesBestAsk,
        depth: yesLiquidity
      },
      no_book: {
        best_bid: getBestPrice(noBook.bids, 'SELL'),
        best_ask: noBestAsk,
        depth: noLiquidity
      }
    };

  } catch (error) {
    console.error(`[Detector] Error analyzing market ${market.conditionId}:`, error.message);
    return null;
  }
}

/**
 * Save order book snapshot to database
 */
function saveSnapshot(marketId, tokenId, tokenType, orderBook) {
  try {
    const bestBid = orderBook.bids?.[0] ? parseFloat(orderBook.bids[0].price) : null;
    const bestAsk = orderBook.asks?.[0] ? parseFloat(orderBook.asks[0].price) : null;
    const bidDepth = calculateLiquidity(orderBook.bids);
    const askDepth = calculateLiquidity(orderBook.asks);
    const spread = (bestBid && bestAsk) ? (bestAsk - bestBid) : null;

    db.snapshots.create({
      market_id: marketId,
      token_id: tokenId,
      token_type: tokenType,
      best_bid: bestBid,
      best_ask: bestAsk,
      bid_depth: bidDepth,
      ask_depth: askDepth,
      spread: spread
    });
  } catch (error) {
    // Don't fail on snapshot errors
    console.error('[Detector] Snapshot error:', error.message);
  }
}

/**
 * Scan all markets and detect opportunities
 */
async function detectOpportunities(markets) {
  const opportunities = [];

  for (const market of markets) {
    const opportunity = await analyzeMarket(market);
    if (opportunity) {
      opportunities.push(opportunity);
      console.log(`[Detector] Opportunity found: ${market.question?.substring(0, 50)}... spread: ${(opportunity.spread * 100).toFixed(2)}%`);
    }
  }

  // Sort by spread (best opportunities first)
  opportunities.sort((a, b) => b.spread - a.spread);

  return opportunities;
}

/**
 * Get real-time order book data for a market
 */
async function getMarketOrderBooks(yesTokenId, noTokenId) {
  try {
    const [yesBook, noBook] = await Promise.all([
      polyClient.getOrderBook(yesTokenId),
      polyClient.getOrderBook(noTokenId)
    ]);

    return {
      yes: {
        bids: yesBook.bids || [],
        asks: yesBook.asks || [],
        best_bid: getBestPrice(yesBook.bids, 'SELL'),
        best_ask: getBestPrice(yesBook.asks, 'BUY')
      },
      no: {
        bids: noBook.bids || [],
        asks: noBook.asks || [],
        best_bid: getBestPrice(noBook.bids, 'SELL'),
        best_ask: getBestPrice(noBook.asks, 'BUY')
      }
    };
  } catch (error) {
    console.error('[Detector] Error fetching order books:', error.message);
    return null;
  }
}

module.exports = {
  analyzeMarket,
  detectOpportunities,
  getMarketOrderBooks,
  calculateLiquidity,
  getBestPrice
};
