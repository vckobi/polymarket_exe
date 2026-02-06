/**
 * WebSocket Handler
 * Real-time communication with dashboard via Socket.io
 */

const db = require('../database');
const riskManager = require('../core/risk-manager');
const orderExecutor = require('../core/order-executor');

/**
 * Setup WebSocket handlers
 */
function setupWebSocket(io, emitter) {
  io.on('connection', (socket) => {
    console.log('[WebSocket] Client connected:', socket.id);

    // Send initial state
    sendInitialState(socket);

    // Handle client events
    socket.on('opportunity:approve', async (data) => {
      try {
        const opportunity = db.pending.getById(data.id);
        if (!opportunity || opportunity.status !== 'pending') {
          socket.emit('error', { message: 'Opportunity not found or not pending' });
          return;
        }

        const riskCheck = await riskManager.canTrade(opportunity);
        if (!riskCheck.allowed) {
          socket.emit('error', { message: riskCheck.reason });
          return;
        }

        const result = await orderExecutor.executeTrade(opportunity, emitter);
        db.pending.updateStatus(opportunity.id, result.success ? 'approved' : 'failed');

        socket.emit('opportunity:approved', { id: data.id, result });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('opportunity:reject', (data) => {
      try {
        db.pending.updateStatus(data.id, 'rejected');
        socket.emit('opportunity:rejected', { id: data.id });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('trade:cancel', async (data) => {
      try {
        const result = await orderExecutor.cancelTrade(data.trade_id, emitter);
        socket.emit('trade:cancelled', result);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('settings:update', (data) => {
      try {
        const updated = db.settings.update(data);
        emitter.emit('settings:changed', updated);
        socket.emit('settings:updated', updated);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('kill_switch:toggle', async () => {
      try {
        await riskManager.toggleKillSwitch(emitter);
        const settings = db.settings.get();
        socket.emit('kill_switch:toggled', { active: settings.kill_switch });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log('[WebSocket] Client disconnected:', socket.id);
    });
  });

  // Forward emitter events to all connected clients
  setupEmitterForwarding(io, emitter);

  return io;
}

/**
 * Send initial state to newly connected client
 */
async function sendInitialState(socket) {
  try {
    const settings = db.settings.get();
    const opportunities = db.pending.getPending();
    const activeTrades = db.trades.getActive();
    const alerts = db.alerts.getUnread();
    const riskStatus = await riskManager.getRiskStatus();

    socket.emit('init', {
      settings,
      opportunities,
      activeTrades,
      alerts,
      riskStatus
    });
  } catch (error) {
    console.error('[WebSocket] Error sending initial state:', error.message);
  }
}

/**
 * Forward emitter events to Socket.io clients
 */
function setupEmitterForwarding(io, emitter) {
  // Opportunity events
  emitter.on('opportunity:new', (data) => {
    io.emit('opportunity:new', data);
  });

  emitter.on('opportunity:expired', (data) => {
    io.emit('opportunity:expired', data);
  });

  // Trade events
  emitter.on('trade:created', (data) => {
    io.emit('trade:created', data);
  });

  emitter.on('trade:filled', (data) => {
    io.emit('trade:filled', data);
  });

  emitter.on('trade:partial', (data) => {
    io.emit('trade:partial', data);
  });

  emitter.on('trade:settled', (data) => {
    io.emit('trade:settled', data);
  });

  emitter.on('trade:cancelled', (data) => {
    io.emit('trade:cancelled', data);
  });

  // Order book updates
  emitter.on('orderbook:update', (data) => {
    io.emit('orderbook:update', data);
  });

  // Balance updates
  emitter.on('balance:update', (data) => {
    io.emit('balance:update', data);
  });

  // Alert events
  emitter.on('alert:new', (data) => {
    io.emit('alert:new', data);
  });

  // Settings changes
  emitter.on('settings:changed', (data) => {
    io.emit('settings:changed', data);
  });

  // Kill switch events
  emitter.on('kill_switch:activated', (data) => {
    io.emit('kill_switch:activated', data);
  });

  emitter.on('kill_switch:deactivated', () => {
    io.emit('kill_switch:deactivated');
  });

  // Stats updates
  emitter.on('stats:update', (data) => {
    io.emit('stats:update', data);
  });
}

module.exports = { setupWebSocket };
