/**
 * Market Scanner
 * Scans Polymarket for 15-minute crypto prediction markets
 */

const polyClient = require('./polymarket-client');
const config = require('../config');
const db = require('../database');

let cachedMarkets = [];
let lastScanTime = 0;
const CACHE_TTL = 30000; // 30 seconds cache

/**
 * Check if a market matches crypto criteria
 * If requireTimeframe is false, matches ANY crypto market
 * If requireTimeframe is true, only matches 15-minute markets
 */
function isTargetMarket(market, activeCurrencies, requireTimeframe = false) {
  const question = (market.question || '').toLowerCase();
  const description = (market.description || '').toLowerCase();
  const combinedText = question + ' ' + description;

  // Check for crypto keywords
  const hasCrypto = activeCurrencies.some(currency =>
    combinedText.includes(currency.toLowerCase())
  );

  if (!hasCrypto) return false;

  // Check for timeframe only if required
  if (requireTimeframe) {
    const { timeframePatterns } = config.marketFilters;
    const has15Min = timeframePatterns.some(pattern =>
      pattern.test(combinedText)
    );
    if (!has15Min) return false;
  }

  // Check if market is still open (not resolved/closed)
  if (market.closed === true || market.resolved === true) {
    return false;
  }

  return true;
}

/**
 * Extract YES and NO token IDs from market data
 */
function extractTokenIds(market) {
  // Markets have tokens array with outcomes
  const tokens = market.tokens || [];

  let yesTokenId = null;
  let noTokenId = null;

  for (const token of tokens) {
    const outcome = (token.outcome || '').toLowerCase();
    if (outcome === 'yes') {
      yesTokenId = token.token_id;
    } else if (outcome === 'no') {
      noTokenId = token.token_id;
    }
  }

  // Some markets use clobTokenIds
  if (!yesTokenId && market.clobTokenIds) {
    yesTokenId = market.clobTokenIds[0];
    noTokenId = market.clobTokenIds[1];
  }

  return { yesTokenId, noTokenId };
}

/**
 * Scan for target markets
 */
async function scanMarkets() {
  const settings = db.settings.get();
  const activeCurrencies = settings.active_currencies || config.defaults.activeCurrencies;

  // Check cache
  const now = Date.now();
  if (cachedMarkets.length > 0 && (now - lastScanTime) < CACHE_TTL) {
    return cachedMarkets;
  }

  console.log('[Scanner] Scanning markets...');

  try {
    const allMarkets = await polyClient.getAllMarkets();
    console.log(`[Scanner] Found ${allMarkets.length} total markets`);

    const targetMarkets = [];

    // For now, don't require 15-min timeframe - show all crypto markets
    const requireTimeframe = false;

    for (const market of allMarkets) {
      if (isTargetMarket(market, activeCurrencies, requireTimeframe)) {
        const { yesTokenId, noTokenId } = extractTokenIds(market);

        if (yesTokenId && noTokenId) {
          targetMarkets.push({
            conditionId: market.condition_id || market.conditionId,
            question: market.question,
            description: market.description,
            yesTokenId,
            noTokenId,
            endDate: market.end_date_iso || market.endDateIso,
            closed: market.closed,
            resolved: market.resolved,
            volume: market.volume,
            liquidity: market.liquidity
          });
        }
      }
    }

    console.log(`[Scanner] Found ${targetMarkets.length} crypto markets`);

    cachedMarkets = targetMarkets;
    lastScanTime = now;

    return targetMarkets;

  } catch (error) {
    console.error('[Scanner] Error scanning markets:', error.message);
    return cachedMarkets; // Return cached on error
  }
}

/**
 * Get a specific market by ID
 */
async function getMarketById(conditionId) {
  // First check cache
  const cached = cachedMarkets.find(m => m.conditionId === conditionId);
  if (cached) return cached;

  // Fetch from API
  const market = await polyClient.getMarket(conditionId);
  if (!market) return null;

  const { yesTokenId, noTokenId } = extractTokenIds(market);

  return {
    conditionId: market.condition_id || market.conditionId,
    question: market.question,
    description: market.description,
    yesTokenId,
    noTokenId,
    endDate: market.end_date_iso || market.endDateIso,
    closed: market.closed,
    resolved: market.resolved
  };
}

/**
 * Clear the market cache
 */
function clearCache() {
  cachedMarkets = [];
  lastScanTime = 0;
}

module.exports = {
  scanMarkets,
  getMarketById,
  clearCache,
  isTargetMarket,
  extractTokenIds
};
