/**
 * Market Scanner
 * Scans Polymarket for 15-minute crypto prediction markets
 * Uses Gamma API for market data (no auth required)
 */

const gammaApi = require('./gamma-api');
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
  // Gamma API uses 'active' field, CLOB uses 'closed'
  if (market.closed === true || market.resolved === true) {
    return false;
  }
  if (market.active === false) {
    return false;
  }

  return true;
}

/**
 * Extract YES and NO token IDs from market data
 * Handles both Gamma API and CLOB API response formats
 */
function extractTokenIds(market) {
  // Markets have tokens array with outcomes
  const tokens = market.tokens || [];

  let yesTokenId = null;
  let noTokenId = null;

  for (const token of tokens) {
    const outcome = (token.outcome || '').toLowerCase();
    if (outcome === 'yes') {
      yesTokenId = token.token_id || token.tokenId;
    } else if (outcome === 'no') {
      noTokenId = token.token_id || token.tokenId;
    }
  }

  // Fallback: clobTokenIds array (Gamma API format)
  if (!yesTokenId && market.clobTokenIds) {
    yesTokenId = market.clobTokenIds[0];
    noTokenId = market.clobTokenIds[1];
  }

  // Fallback: clob_token_ids (snake_case format)
  if (!yesTokenId && market.clob_token_ids) {
    yesTokenId = market.clob_token_ids[0];
    noTokenId = market.clob_token_ids[1];
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

  console.log('[Scanner] Scanning markets via Gamma API...');

  try {
    const allMarkets = await gammaApi.fetchAllMarkets();
    console.log(`[Scanner] Found ${allMarkets.length} total markets`);

    const targetMarkets = [];

    // For now, don't require 15-min timeframe - show all crypto markets
    const requireTimeframe = false;

    for (const market of allMarkets) {
      if (isTargetMarket(market, activeCurrencies, requireTimeframe)) {
        const { yesTokenId, noTokenId } = extractTokenIds(market);

        if (yesTokenId && noTokenId) {
          targetMarkets.push({
            conditionId: market.condition_id || market.conditionId || market.id,
            question: market.question,
            description: market.description,
            yesTokenId,
            noTokenId,
            endDate: market.end_date_iso || market.endDateIso || market.endDate,
            closed: market.closed || market.active === false,
            resolved: market.resolved,
            volume: market.volume || market.volumeNum || 0,
            liquidity: market.liquidity || market.liquidityNum || 0
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

  // Fetch from Gamma API
  const market = await gammaApi.getMarket(conditionId);
  if (!market) return null;

  const { yesTokenId, noTokenId } = extractTokenIds(market);

  return {
    conditionId: market.condition_id || market.conditionId || market.id,
    question: market.question,
    description: market.description,
    yesTokenId,
    noTokenId,
    endDate: market.end_date_iso || market.endDateIso || market.endDate,
    closed: market.closed || market.active === false,
    resolved: market.resolved
  };
}

/**
 * Clear the market cache
 */
function clearCache() {
  cachedMarkets = [];
  lastScanTime = 0;
  gammaApi.clearCache();
}

module.exports = {
  scanMarkets,
  getMarketById,
  clearCache,
  isTargetMarket,
  extractTokenIds
};
