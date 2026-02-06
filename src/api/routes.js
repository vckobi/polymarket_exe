/**
 * API Routes
 * REST API endpoints for the bot dashboard
 */

const express = require('express');
const db = require('../database');
const polyClient = require('../core/polymarket-client');
const marketScanner = require('../core/market-scanner');
const opportunityDetector = require('../core/opportunity-detector');
const orderExecutor = require('../core/order-executor');
const riskManager = require('../core/risk-manager');

/**
 * Setup all API routes
 */
function setupRoutes(app, emitter) {
  const router = express.Router();

  // ==================== SETTINGS ====================

  // Get settings
  router.get('/settings', (req, res) => {
    try {
      const settings = db.settings.get();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update settings
  router.put('/settings', (req, res) => {
    try {
      const updated = db.settings.update(req.body);
      emitter.emit('settings:changed', updated);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Toggle kill switch
  router.post('/kill-switch', async (req, res) => {
    try {
      await riskManager.toggleKillSwitch(emitter);
      const settings = db.settings.get();
      res.json({ kill_switch: settings.kill_switch });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== TRADES ====================

  // Get all trades
  router.get('/trades', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      const trades = db.trades.getAll(limit, offset);
      res.json(trades);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get active trades
  router.get('/trades/active', (req, res) => {
    try {
      const trades = db.trades.getActive();
      res.json(trades);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single trade
  router.get('/trades/:id', (req, res) => {
    try {
      const trade = db.trades.getById(parseInt(req.params.id));
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      res.json(trade);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cancel trade
  router.post('/trades/:id/cancel', async (req, res) => {
    try {
      const result = await orderExecutor.cancelTrade(parseInt(req.params.id), emitter);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== OPPORTUNITIES ====================

  // Get pending opportunities
  router.get('/opportunities', (req, res) => {
    try {
      const opportunities = db.pending.getPending();
      res.json(opportunities);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Approve opportunity
  router.post('/opportunities/:id/approve', async (req, res) => {
    try {
      const opportunity = db.pending.getById(parseInt(req.params.id));
      if (!opportunity) {
        return res.status(404).json({ error: 'Opportunity not found' });
      }

      if (opportunity.status !== 'pending') {
        return res.status(400).json({ error: 'Opportunity is not pending' });
      }

      // Check risk
      const riskCheck = await riskManager.canTrade(opportunity);
      if (!riskCheck.allowed) {
        return res.status(400).json({ error: riskCheck.reason });
      }

      // Execute trade
      const result = await orderExecutor.executeTrade(opportunity, emitter);

      // Update opportunity status
      db.pending.updateStatus(opportunity.id, result.success ? 'approved' : 'failed');

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Reject opportunity
  router.post('/opportunities/:id/reject', (req, res) => {
    try {
      const opportunity = db.pending.getById(parseInt(req.params.id));
      if (!opportunity) {
        return res.status(404).json({ error: 'Opportunity not found' });
      }

      db.pending.updateStatus(opportunity.id, 'rejected');
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== MARKETS ====================

  // Get target markets
  router.get('/markets', async (req, res) => {
    try {
      const markets = await marketScanner.scanMarkets();
      res.json(markets);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Debug: Get all crypto markets (without 15-min filter)
  router.get('/markets/debug', async (req, res) => {
    try {
      const allMarkets = await polyClient.getAllMarkets();
      const settings = db.settings.get();
      const currencies = settings.active_currencies || ['BTC', 'ETH'];

      // Find crypto markets
      const cryptoMarkets = allMarkets.filter(m => {
        const q = (m.question || '').toLowerCase();
        return currencies.some(c => q.includes(c.toLowerCase()));
      }).filter(m => !m.closed && !m.resolved);

      res.json({
        total: allMarkets.length,
        crypto_count: cryptoMarkets.length,
        samples: cryptoMarkets.slice(0, 20).map(m => ({
          question: m.question,
          closed: m.closed,
          resolved: m.resolved
        }))
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get order book for a market
  router.get('/orderbook/:yesTokenId/:noTokenId', async (req, res) => {
    try {
      const books = await opportunityDetector.getMarketOrderBooks(
        req.params.yesTokenId,
        req.params.noTokenId
      );
      res.json(books);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== STATS ====================

  // Get statistics summary
  router.get('/stats', async (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const todayPnL = db.pnl.getToday();
      const activeTrades = db.trades.getActive();
      const allTrades = db.trades.getAll(1000, 0);

      // Calculate totals
      const totalTrades = allTrades.length;
      const settledTrades = allTrades.filter(t => t.status === 'settled');
      const winningTrades = settledTrades.filter(t => t.actual_profit > 0);
      const totalProfit = settledTrades.reduce((sum, t) => sum + (t.actual_profit || 0), 0);

      res.json({
        today: {
          date: today,
          trades: todayPnL?.total_trades || 0,
          pnl: todayPnL?.realized_pnl || 0
        },
        all_time: {
          total_trades: totalTrades,
          settled_trades: settledTrades.length,
          winning_trades: winningTrades.length,
          win_rate: settledTrades.length > 0 ? (winningTrades.length / settledTrades.length * 100).toFixed(1) : 0,
          total_profit: totalProfit
        },
        active_positions: activeTrades.length,
        pending_opportunities: db.pending.getPending().length
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get P&L history
  router.get('/stats/pnl', (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const endDate = new Date();

      const pnl = db.pnl.getRange(
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );
      res.json(pnl);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get balance
  router.get('/balance', async (req, res) => {
    try {
      const balance = await polyClient.getBalance();
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get risk status
  router.get('/risk', async (req, res) => {
    try {
      const status = await riskManager.getRiskStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== ALERTS ====================

  // Get alerts
  router.get('/alerts', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;
      const alerts = db.alerts.getAll(limit, offset);
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get unread alerts count
  router.get('/alerts/unread', (req, res) => {
    try {
      const count = db.alerts.countUnread();
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark alert as read
  router.post('/alerts/:id/read', (req, res) => {
    try {
      db.alerts.markRead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mark all alerts as read
  router.post('/alerts/read-all', (req, res) => {
    try {
      db.alerts.markAllRead();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Mount router
  app.use('/api', router);

  return router;
}

module.exports = { setupRoutes };
