/**
 * Gamma API Client
 * Uses Polymarket's public Gamma API for market data (no authentication required)
 * https://gamma-api.polymarket.com
 */

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

// Cache for markets
let marketsCache = [];
let marketsCacheTime = 0;
const MARKETS_CACHE_TTL = 60000; // 1 minute cache

/**
 * Fetch all markets from Gamma API with pagination
 */
async function fetchAllMarkets() {
  // Return cache if fresh
  const now = Date.now();
  if (marketsCache.length > 0 && (now - marketsCacheTime) < MARKETS_CACHE_TTL) {
    console.log(`[Gamma API] Using cached markets (${marketsCache.length} markets)`);
    return marketsCache;
  }

  console.log('[Gamma API] Fetching markets from gamma-api.polymarket.com...');

  let allMarkets = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  try {
    while (hasMore) {
      const url = `${GAMMA_API_BASE}/markets?limit=${limit}&offset=${offset}&active=true`;

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
      }

      const markets = await response.json();

      if (!Array.isArray(markets) || markets.length === 0) {
        hasMore = false;
      } else {
        allMarkets = allMarkets.concat(markets);
        offset += limit;

        // Safety limit
        if (offset >= 5000) {
          console.log('[Gamma API] Reached offset limit');
          hasMore = false;
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Update cache
    marketsCache = allMarkets;
    marketsCacheTime = now;

    console.log(`[Gamma API] Fetched ${allMarkets.length} active markets`);
    return allMarkets;

  } catch (error) {
    console.error('[Gamma API] Error fetching markets:', error.message);

    // Return cache on error
    if (marketsCache.length > 0) {
      console.log('[Gamma API] Returning cached markets on error');
      return marketsCache;
    }
    throw error;
  }
}

/**
 * Get a specific market by condition ID
 */
async function getMarket(conditionId) {
  try {
    const url = `${GAMMA_API_BASE}/markets/${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Gamma API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[Gamma API] Error fetching market ${conditionId}:`, error.message);
    return null;
  }
}

/**
 * Search markets by query
 */
async function searchMarkets(query) {
  try {
    const url = `${GAMMA_API_BASE}/markets?_q=${encodeURIComponent(query)}&active=true&limit=50`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[Gamma API] Error searching markets:', error.message);
    return [];
  }
}

/**
 * Clear the cache
 */
function clearCache() {
  marketsCache = [];
  marketsCacheTime = 0;
}

module.exports = {
  fetchAllMarkets,
  getMarket,
  searchMarkets,
  clearCache
};
