/**
 * Configuration module
 * Loads environment variables and provides app-wide constants
 */

require('dotenv').config();

const config = {
  // Polymarket settings
  polymarket: {
    host: 'https://clob.polymarket.com',
    chainId: 137, // Polygon mainnet
    privateKey: process.env.POLY_PRIVATE_KEY || '',
    funderAddress: process.env.POLY_FUNDER_ADDRESS || '',
    apiKey: process.env.POLY_API_KEY || '',
    secret: process.env.POLY_SECRET || '',
    passphrase: process.env.POLY_PASSPHRASE || '',
    signatureType: 1 // POLY_GNOSIS_SAFE
  },

  // Server settings
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || 'localhost'
  },

  // Database settings
  database: {
    path: process.env.DB_PATH || './data/bot.db'
  },

  // Default bot settings (can be changed via UI)
  defaults: {
    positionSize: 0.5,        // $ per trade pair
    profitThreshold: 0.01,    // 1% minimum spread
    autoMode: false,
    killSwitch: false,
    dailyLossLimit: 50.0,     // $ max daily loss
    maxOpenPositions: 10,
    activeCurrencies: ['BTC', 'ETH'],
    scanIntervalMs: 30000     // 30 seconds (to avoid rate limits)
  },

  // Market filter patterns for 15-min crypto markets
  marketFilters: {
    timeframePatterns: [
      /15[\s-]?min/i,
      /15m/i,
      /fifteen.?minute/i
    ],
    cryptoKeywords: ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'MATIC', 'AVAX', 'LINK', 'DOT']
  }
};

module.exports = config;
