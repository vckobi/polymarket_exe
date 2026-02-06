/**
 * Polymarket CLOB Client Wrapper
 * Wraps @polymarket/clob-client with error handling and logging
 */

const { ClobClient, Side, OrderType } = require('@polymarket/clob-client');
const { Wallet } = require('ethers');
const config = require('../config');

let client = null;

/**
 * Initialize the Polymarket CLOB client
 */
async function initPolymarketClient() {
  const { polymarket } = config;

  if (!polymarket.privateKey) {
    throw new Error('POLY_PRIVATE_KEY is required');
  }

  const signer = new Wallet(polymarket.privateKey);

  // Check if we have API credentials
  let creds = null;
  if (polymarket.apiKey) {
    creds = {
      key: polymarket.apiKey,
      secret: polymarket.secret,
      passphrase: polymarket.passphrase
    };
  }

  // Create temporary client to derive credentials if needed
  if (!creds) {
    const tempClient = new ClobClient(polymarket.host, polymarket.chainId, signer);
    creds = await tempClient.createOrDeriveApiKey();
    console.log('[Polymarket] Created new API credentials');
  }

  // Create the main client
  client = new ClobClient(
    polymarket.host,
    polymarket.chainId,
    signer,
    creds,
    polymarket.signatureType,
    polymarket.funderAddress || undefined
  );

  console.log('[Polymarket] Client initialized');
  return client;
}

/**
 * Get the initialized client
 */
function getClient() {
  if (!client) {
    throw new Error('Polymarket client not initialized. Call initPolymarketClient() first.');
  }
  return client;
}

/**
 * Get all markets with pagination
 */
async function getAllMarkets() {
  const c = getClient();
  let allMarkets = [];
  let cursor = null;

  do {
    const response = await c.getMarkets(cursor);
    allMarkets = allMarkets.concat(response.data || []);
    cursor = response.next_cursor;
  } while (cursor && cursor !== 'LTE=');

  return allMarkets;
}

/**
 * Get order book for a token
 */
async function getOrderBook(tokenId) {
  const c = getClient();
  return await c.getOrderBook(tokenId);
}

/**
 * Get order books for multiple tokens
 */
async function getOrderBooks(params) {
  const c = getClient();
  return await c.getOrderBooks(params);
}

/**
 * Get balance and allowance
 */
async function getBalance() {
  const c = getClient();
  try {
    const balance = await c.getBalanceAllowance({ asset_type: 'COLLATERAL' });
    return {
      balance: parseFloat(balance.balance),
      allowance: parseFloat(balance.allowance)
    };
  } catch (error) {
    console.error('[Polymarket] Error getting balance:', error.message);
    return { balance: 0, allowance: 0 };
  }
}

/**
 * Place a limit order
 * @param {Object} params
 * @param {string} params.tokenId - Token ID
 * @param {number} params.price - Price (0-1)
 * @param {number} params.size - Size in shares
 * @param {string} params.side - 'BUY' or 'SELL'
 */
async function placeOrder(params) {
  const c = getClient();

  const userOrder = {
    tokenID: params.tokenId,
    price: params.price,
    size: params.size,
    side: params.side === 'BUY' ? Side.BUY : Side.SELL
  };

  const options = { tickSize: '0.01' };

  try {
    const result = await c.createAndPostOrder(userOrder, options, OrderType.GTC);
    console.log('[Polymarket] Order placed:', result.orderID || result);
    return result;
  } catch (error) {
    console.error('[Polymarket] Order failed:', error.message);
    throw error;
  }
}

/**
 * Cancel a specific order
 */
async function cancelOrder(orderId) {
  const c = getClient();
  try {
    await c.cancelOrder({ orderID: orderId });
    console.log('[Polymarket] Order cancelled:', orderId);
    return true;
  } catch (error) {
    console.error('[Polymarket] Cancel failed:', error.message);
    return false;
  }
}

/**
 * Cancel all orders
 */
async function cancelAllOrders() {
  const c = getClient();
  try {
    await c.cancelAll();
    console.log('[Polymarket] All orders cancelled');
    return true;
  } catch (error) {
    console.error('[Polymarket] Cancel all failed:', error.message);
    return false;
  }
}

/**
 * Get open orders
 */
async function getOpenOrders(params = {}) {
  const c = getClient();
  try {
    const orders = await c.getOpenOrders(params);
    return orders;
  } catch (error) {
    console.error('[Polymarket] Error getting open orders:', error.message);
    return [];
  }
}

/**
 * Get a specific order by ID
 */
async function getOrder(orderId) {
  const c = getClient();
  try {
    return await c.getOrder(orderId);
  } catch (error) {
    console.error('[Polymarket] Error getting order:', error.message);
    return null;
  }
}

/**
 * Get trades
 */
async function getTrades(params = {}) {
  const c = getClient();
  try {
    return await c.getTrades(params);
  } catch (error) {
    console.error('[Polymarket] Error getting trades:', error.message);
    return [];
  }
}

/**
 * Get market by condition ID
 */
async function getMarket(conditionId) {
  const c = getClient();
  try {
    return await c.getMarket(conditionId);
  } catch (error) {
    console.error('[Polymarket] Error getting market:', error.message);
    return null;
  }
}

module.exports = {
  initPolymarketClient,
  getClient,
  getAllMarkets,
  getOrderBook,
  getOrderBooks,
  getBalance,
  placeOrder,
  cancelOrder,
  cancelAllOrders,
  getOpenOrders,
  getOrder,
  getTrades,
  getMarket,
  Side,
  OrderType
};
