/**
 * Polymarket Market Making Bot
 * Main entry point
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { EventEmitter } = require('events');

const config = require('./config');
const db = require('./database');
const polyClient = require('./core/polymarket-client');
const marketScanner = require('./core/market-scanner');
const opportunityDetector = require('./core/opportunity-detector');
const orderExecutor = require('./core/order-executor');
const riskManager = require('./core/risk-manager');
const { setupRoutes } = require('./api/routes');
const { setupWebSocket } = require('./websocket');

// Global event emitter for inter-component communication
const emitter = new EventEmitter();

// Scanning interval reference
let scanInterval = null;

/**
 * Main scanning loop
 */
async function runScanningLoop() {
  const settings = db.settings.get();

  // Skip if kill switch is active
  if (settings.kill_switch) {
    return;
  }

  try {
    // Check risk conditions
    const riskTriggered = await riskManager.checkRiskConditions(emitter);
    if (riskTriggered) return;

    // Scan for target markets
    const markets = await marketScanner.scanMarkets();

    if (markets.length === 0) {
      return;
    }

    // Detect opportunities
    const opportunities = await opportunityDetector.detectOpportunities(markets);

    // Process each opportunity
    for (const opportunity of opportunities) {
      // Check if we already have this opportunity pending
      const existing = db.pending.getPending().find(
        p => p.market_id === opportunity.market_id
      );

      if (existing) {
        continue; // Skip duplicate
      }

      // Risk check
      const riskCheck = await riskManager.canTrade(opportunity);
      if (!riskCheck.allowed) {
        console.log(`[Scanner] Opportunity rejected: ${riskCheck.reason}`);
        continue;
      }

      // Reload settings to check auto mode
      const currentSettings = db.settings.get();

      if (currentSettings.auto_mode) {
        // Auto mode: execute immediately
        console.log('[Scanner] Auto mode: executing trade');
        await orderExecutor.executeTrade(opportunity, emitter);
      } else {
        // Manual mode: store for approval
        console.log('[Scanner] Manual mode: storing opportunity for approval');
        const pending = db.pending.create(opportunity);
        emitter.emit('opportunity:new', pending);

        // Create alert
        const alert = db.alerts.create({
          type: 'opportunity',
          severity: 'info',
          message: `New opportunity: ${opportunity.market_question?.substring(0, 50)}... (${(opportunity.spread * 100).toFixed(2)}% spread)`,
          data: { opportunity_id: pending.id, spread: opportunity.spread }
        });
        emitter.emit('alert:new', alert);
      }
    }

    // Expire old pending approvals
    db.pending.expireOld();

    // Update balance
    const balance = await polyClient.getBalance();
    emitter.emit('balance:update', balance);

  } catch (error) {
    console.error('[Scanner] Error in scanning loop:', error.message);

    db.alerts.create({
      type: 'error',
      severity: 'error',
      message: `Scanning error: ${error.message}`
    });
  }
}

/**
 * Start the scanning loop
 */
function startScanning() {
  const settings = db.settings.get();
  const interval = settings.scan_interval_ms || config.defaults.scanIntervalMs;

  console.log(`[Scanner] Starting scanning loop (interval: ${interval}ms)`);

  // Run immediately
  runScanningLoop();

  // Then run on interval
  scanInterval = setInterval(runScanningLoop, interval);
}

/**
 * Stop the scanning loop
 */
function stopScanning() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log('[Scanner] Scanning loop stopped');
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(50));
  console.log('Polymarket Market Making Bot');
  console.log('='.repeat(50));

  try {
    // Initialize database
    console.log('[Init] Initializing database...');
    db.initDatabase();

    // Initialize Polymarket client
    console.log('[Init] Initializing Polymarket client...');
    await polyClient.initPolymarketClient();

    // Check balance
    const balance = await polyClient.getBalance();
    console.log(`[Init] Balance: $${balance.balance.toFixed(2)}`);

    // Create Express app
    const app = express();
    const server = http.createServer(app);

    // Setup Socket.io
    const io = new Server(server, {
      cors: { origin: '*' }
    });

    // Middleware
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));

    // Setup API routes
    setupRoutes(app, emitter);

    // Setup WebSocket
    setupWebSocket(io, emitter);

    // Serve index.html for root
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // Start server
    const port = config.server.port;
    server.listen(port, () => {
      console.log(`[Server] Dashboard running at http://localhost:${port}`);
    });

    // Start scanning loop
    startScanning();

    // Handle settings changes to restart scanning with new interval
    emitter.on('settings:changed', (settings) => {
      if (settings.scan_interval_ms) {
        stopScanning();
        startScanning();
      }
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n[Shutdown] Received SIGINT, shutting down...');
      stopScanning();

      // Cancel all orders on shutdown (safety)
      const settings = db.settings.get();
      if (!settings.kill_switch) {
        console.log('[Shutdown] Cancelling all orders...');
        await polyClient.cancelAllOrders();
      }

      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[Shutdown] Received SIGTERM, shutting down...');
      stopScanning();
      process.exit(0);
    });

    // Create startup alert
    db.alerts.create({
      type: 'system',
      severity: 'info',
      message: 'Bot started successfully',
      data: { balance: balance.balance }
    });

  } catch (error) {
    console.error('[Fatal] Failed to start:', error.message);
    process.exit(1);
  }
}

// Run
main();
