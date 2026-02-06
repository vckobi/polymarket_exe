/**
 * Main Application
 * Dashboard UI logic and WebSocket handling
 */

// State
let socket = null;
let settings = {};
let markets = [];
let selectedMarket = null;

// DOM Elements
const elements = {
  // Header
  modeBadge: document.getElementById('mode-badge'),
  balanceValue: document.getElementById('balance-value'),
  connectionStatus: document.getElementById('connection-status'),
  killSwitchBtn: document.getElementById('kill-switch-btn'),

  // Stats
  todayPnl: document.getElementById('today-pnl'),
  openPositions: document.getElementById('open-positions'),
  totalTrades: document.getElementById('total-trades'),
  winRate: document.getElementById('win-rate'),
  allTimePnl: document.getElementById('all-time-pnl'),

  // Opportunities
  opportunitiesCount: document.getElementById('opportunities-count'),
  opportunityList: document.getElementById('opportunity-list'),

  // Order Book
  orderbookSelect: document.getElementById('orderbook-market-select'),
  yesAsks: document.getElementById('yes-asks'),
  yesBids: document.getElementById('yes-bids'),
  yesSpread: document.getElementById('yes-spread'),
  noAsks: document.getElementById('no-asks'),
  noBids: document.getElementById('no-bids'),
  noSpread: document.getElementById('no-spread'),

  // Trades
  tradesTbody: document.getElementById('trades-tbody'),
  refreshTradesBtn: document.getElementById('refresh-trades-btn'),

  // Settings
  settingsForm: document.getElementById('settings-form'),
  positionSize: document.getElementById('position-size'),
  profitThreshold: document.getElementById('profit-threshold'),
  dailyLossLimit: document.getElementById('daily-loss-limit'),
  maxPositions: document.getElementById('max-positions'),
  autoMode: document.getElementById('auto-mode'),
  currenciesGroup: document.getElementById('currencies-group'),
  scanInterval: document.getElementById('scan-interval'),

  // Alerts
  unreadCount: document.getElementById('unread-count'),
  alertsList: document.getElementById('alerts-list'),
  markAllReadBtn: document.getElementById('mark-all-read-btn'),

  // Toast
  toastContainer: document.getElementById('toast-container')
};

// ==================== INITIALIZATION ====================

async function init() {
  console.log('Initializing dashboard...');

  // Connect WebSocket
  connectWebSocket();

  // Load initial data
  await Promise.all([
    loadSettings(),
    loadStats(),
    loadTrades(),
    loadOpportunities(),
    loadAlerts(),
    loadMarkets()
  ]);

  // Setup event listeners
  setupEventListeners();
}

// ==================== WEBSOCKET ====================

function connectWebSocket() {
  socket = io();

  socket.on('connect', () => {
    console.log('WebSocket connected');
    updateConnectionStatus(true);
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
    updateConnectionStatus(false);
  });

  socket.on('init', (data) => {
    console.log('Received initial state:', data);
    if (data.settings) updateSettingsUI(data.settings);
    if (data.opportunities) renderOpportunities(data.opportunities);
    if (data.activeTrades) renderTrades(data.activeTrades);
    if (data.alerts) renderAlerts(data.alerts);
    if (data.riskStatus) updateRiskStatus(data.riskStatus);
  });

  socket.on('opportunity:new', (opportunity) => {
    showToast('New opportunity detected!', 'info');
    loadOpportunities();
  });

  socket.on('trade:created', (trade) => {
    showToast('Trade placed!', 'success');
    loadTrades();
    loadStats();
  });

  socket.on('trade:settled', (data) => {
    const pnl = data.profit >= 0 ? `+$${data.profit.toFixed(4)}` : `-$${Math.abs(data.profit).toFixed(4)}`;
    showToast(`Trade settled: ${pnl}`, data.profit >= 0 ? 'success' : 'warning');
    loadTrades();
    loadStats();
  });

  socket.on('balance:update', (balance) => {
    updateBalance(balance.balance);
  });

  socket.on('alert:new', (alert) => {
    loadAlerts();
    if (alert.severity === 'critical') {
      showToast(alert.message, 'error');
    }
  });

  socket.on('settings:changed', (newSettings) => {
    settings = newSettings;
    updateSettingsUI(newSettings);
  });

  socket.on('kill_switch:activated', (data) => {
    showToast(`KILL SWITCH ACTIVATED: ${data.reason}`, 'error');
    updateKillSwitchUI(true);
    loadSettings();
  });

  socket.on('kill_switch:deactivated', () => {
    showToast('Kill switch deactivated', 'info');
    updateKillSwitchUI(false);
  });

  socket.on('error', (data) => {
    showToast(data.message, 'error');
  });
}

function updateConnectionStatus(connected) {
  elements.connectionStatus.classList.toggle('connected', connected);
  elements.connectionStatus.querySelector('.text').textContent = connected ? 'Connected' : 'Disconnected';
}

// ==================== DATA LOADING ====================

async function loadSettings() {
  try {
    settings = await API.getSettings();
    updateSettingsUI(settings);
  } catch (error) {
    showToast('Failed to load settings', 'error');
  }
}

async function loadStats() {
  try {
    const stats = await API.getStats();
    updateStatsUI(stats);
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

async function loadTrades() {
  try {
    const trades = await API.getTrades(50);
    renderTrades(trades);
  } catch (error) {
    console.error('Failed to load trades:', error);
  }
}

async function loadOpportunities() {
  try {
    const opportunities = await API.getOpportunities();
    renderOpportunities(opportunities);
  } catch (error) {
    console.error('Failed to load opportunities:', error);
  }
}

async function loadAlerts() {
  try {
    const alerts = await API.getAlerts();
    renderAlerts(alerts);

    const unread = await API.getUnreadCount();
    elements.unreadCount.textContent = unread.count;
  } catch (error) {
    console.error('Failed to load alerts:', error);
  }
}

async function loadMarkets() {
  try {
    markets = await API.getMarkets();
    updateMarketSelect();
  } catch (error) {
    console.error('Failed to load markets:', error);
  }
}

async function loadBalance() {
  try {
    const balance = await API.getBalance();
    updateBalance(balance.balance);
  } catch (error) {
    console.error('Failed to load balance:', error);
  }
}

// ==================== UI UPDATES ====================

function updateSettingsUI(s) {
  settings = s;

  elements.positionSize.value = s.position_size;
  elements.profitThreshold.value = (s.profit_threshold * 100).toFixed(1);
  elements.dailyLossLimit.value = s.daily_loss_limit;
  elements.maxPositions.value = s.max_open_positions;
  elements.autoMode.value = s.auto_mode ? '1' : '0';
  elements.scanInterval.value = Math.round(s.scan_interval_ms / 1000);

  // Update currencies checkboxes
  const currencies = s.active_currencies || [];
  elements.currenciesGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.checked = currencies.includes(cb.value);
  });

  // Update mode badge
  elements.modeBadge.textContent = s.auto_mode ? 'Auto' : 'Manual';
  elements.modeBadge.className = 'badge ' + (s.auto_mode ? 'mode-auto' : 'mode-manual');

  // Update kill switch button
  updateKillSwitchUI(s.kill_switch);
}

function updateKillSwitchUI(active) {
  elements.killSwitchBtn.classList.toggle('active', active);
  elements.killSwitchBtn.textContent = active ? 'RESUME TRADING' : 'KILL SWITCH';
}

function updateStatsUI(stats) {
  const todayPnl = stats.today?.pnl || 0;
  elements.todayPnl.textContent = formatCurrency(todayPnl);
  elements.todayPnl.className = 'stat-value ' + (todayPnl >= 0 ? 'positive' : 'negative');

  elements.openPositions.textContent = stats.active_positions || 0;
  elements.totalTrades.textContent = stats.all_time?.total_trades || 0;
  elements.winRate.textContent = (stats.all_time?.win_rate || 0) + '%';

  const allTimePnl = stats.all_time?.total_profit || 0;
  elements.allTimePnl.textContent = formatCurrency(allTimePnl);
  elements.allTimePnl.className = 'stat-value ' + (allTimePnl >= 0 ? 'positive' : 'negative');
}

function updateBalance(balance) {
  elements.balanceValue.textContent = formatCurrency(balance);
}

function updateRiskStatus(status) {
  updateKillSwitchUI(status.kill_switch);
  updateBalance(status.balance);
}

function updateMarketSelect() {
  elements.orderbookSelect.innerHTML = '<option value="">Select a market...</option>';
  markets.forEach((market, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = market.question?.substring(0, 60) + '...';
    elements.orderbookSelect.appendChild(option);
  });
}

// ==================== RENDERING ====================

function renderOpportunities(opportunities) {
  elements.opportunitiesCount.textContent = opportunities.length;

  if (opportunities.length === 0) {
    elements.opportunityList.innerHTML = '<div class="empty-state">No opportunities detected</div>';
    return;
  }

  elements.opportunityList.innerHTML = opportunities.map(opp => `
    <div class="opportunity-card" data-id="${opp.id}">
      <div class="opportunity-header">
        <div class="opportunity-question">${escapeHtml(opp.market_question || 'Unknown market')}</div>
        <div class="opportunity-spread">${(opp.spread * 100).toFixed(2)}%</div>
      </div>
      <div class="opportunity-details">
        <div>YES: $${opp.yes_price?.toFixed(3) || '-'}</div>
        <div>NO: $${opp.no_price?.toFixed(3) || '-'}</div>
        <div>Profit: $${opp.expected_profit?.toFixed(4) || '-'}</div>
      </div>
      <div class="opportunity-actions">
        <button class="btn-approve" onclick="approveOpportunity(${opp.id})">Approve</button>
        <button class="btn-reject" onclick="rejectOpportunity(${opp.id})">Reject</button>
      </div>
    </div>
  `).join('');
}

function renderTrades(trades) {
  if (trades.length === 0) {
    elements.tradesTbody.innerHTML = '<tr class="empty-row"><td colspan="6">No trades yet</td></tr>';
    return;
  }

  elements.tradesTbody.innerHTML = trades.map(trade => `
    <tr>
      <td>${formatTime(trade.created_at)}</td>
      <td title="${escapeHtml(trade.market_question || '')}">${escapeHtml((trade.market_question || 'Unknown').substring(0, 30))}...</td>
      <td>$${trade.total_cost?.toFixed(4) || '-'}</td>
      <td class="status-${trade.status}">${trade.status}</td>
      <td class="${trade.actual_profit >= 0 ? 'positive' : 'negative'}">${trade.actual_profit != null ? formatCurrency(trade.actual_profit) : '-'}</td>
      <td>
        ${trade.status === 'placed' || trade.status === 'pending' ?
          `<button class="btn-small" onclick="cancelTrade(${trade.id})">Cancel</button>` :
          ''}
      </td>
    </tr>
  `).join('');
}

function renderAlerts(alerts) {
  if (alerts.length === 0) {
    elements.alertsList.innerHTML = '<div class="empty-state">No alerts</div>';
    return;
  }

  elements.alertsList.innerHTML = alerts.map(alert => `
    <div class="alert-item ${alert.severity} ${alert.read ? 'read' : 'unread'}" data-id="${alert.id}">
      <div class="alert-content">
        <div class="alert-message">${escapeHtml(alert.message)}</div>
        <div class="alert-time">${formatTime(alert.created_at)}</div>
      </div>
    </div>
  `).join('');
}

function renderOrderBook(books) {
  if (!books) {
    elements.yesAsks.innerHTML = '<div class="empty-state">-</div>';
    elements.yesBids.innerHTML = '<div class="empty-state">-</div>';
    elements.noAsks.innerHTML = '<div class="empty-state">-</div>';
    elements.noBids.innerHTML = '<div class="empty-state">-</div>';
    return;
  }

  // YES side
  elements.yesAsks.innerHTML = (books.yes.asks || []).slice(0, 5).reverse().map(o =>
    `<div class="row"><span>${parseFloat(o.price).toFixed(3)}</span><span>${parseFloat(o.size).toFixed(2)}</span></div>`
  ).join('');

  elements.yesBids.innerHTML = (books.yes.bids || []).slice(0, 5).map(o =>
    `<div class="row"><span>${parseFloat(o.price).toFixed(3)}</span><span>${parseFloat(o.size).toFixed(2)}</span></div>`
  ).join('');

  const yesSpread = books.yes.best_ask && books.yes.best_bid ?
    ((books.yes.best_ask - books.yes.best_bid) * 100).toFixed(2) : '-';
  elements.yesSpread.textContent = `Spread: ${yesSpread}%`;

  // NO side
  elements.noAsks.innerHTML = (books.no.asks || []).slice(0, 5).reverse().map(o =>
    `<div class="row"><span>${parseFloat(o.price).toFixed(3)}</span><span>${parseFloat(o.size).toFixed(2)}</span></div>`
  ).join('');

  elements.noBids.innerHTML = (books.no.bids || []).slice(0, 5).map(o =>
    `<div class="row"><span>${parseFloat(o.price).toFixed(3)}</span><span>${parseFloat(o.size).toFixed(2)}</span></div>`
  ).join('');

  const noSpread = books.no.best_ask && books.no.best_bid ?
    ((books.no.best_ask - books.no.best_bid) * 100).toFixed(2) : '-';
  elements.noSpread.textContent = `Spread: ${noSpread}%`;
}

// ==================== EVENT HANDLERS ====================

function setupEventListeners() {
  // Kill switch
  elements.killSwitchBtn.addEventListener('click', async () => {
    try {
      await API.toggleKillSwitch();
      await loadSettings();
    } catch (error) {
      showToast('Failed to toggle kill switch', 'error');
    }
  });

  // Refresh trades
  elements.refreshTradesBtn.addEventListener('click', loadTrades);

  // Settings form
  elements.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currencies = Array.from(elements.currenciesGroup.querySelectorAll('input:checked'))
      .map(cb => cb.value);

    const newSettings = {
      position_size: parseFloat(elements.positionSize.value),
      profit_threshold: parseFloat(elements.profitThreshold.value) / 100,
      daily_loss_limit: parseFloat(elements.dailyLossLimit.value),
      max_open_positions: parseInt(elements.maxPositions.value),
      auto_mode: elements.autoMode.value === '1',
      active_currencies: currencies,
      scan_interval_ms: parseInt(elements.scanInterval.value) * 1000
    };

    try {
      await API.updateSettings(newSettings);
      showToast('Settings saved', 'success');
      await loadSettings();
    } catch (error) {
      showToast('Failed to save settings', 'error');
    }
  });

  // Order book market select
  elements.orderbookSelect.addEventListener('change', async (e) => {
    const index = e.target.value;
    if (index === '') {
      selectedMarket = null;
      renderOrderBook(null);
      return;
    }

    selectedMarket = markets[parseInt(index)];
    try {
      const books = await API.getOrderBook(selectedMarket.yesTokenId, selectedMarket.noTokenId);
      renderOrderBook(books);
    } catch (error) {
      showToast('Failed to load order book', 'error');
    }
  });

  // Mark all alerts read
  elements.markAllReadBtn.addEventListener('click', async () => {
    try {
      await API.markAllAlertsRead();
      await loadAlerts();
    } catch (error) {
      showToast('Failed to mark alerts as read', 'error');
    }
  });

  // Periodic refresh
  setInterval(loadStats, 30000);
  setInterval(loadBalance, 60000);
}

// Global action functions
async function approveOpportunity(id) {
  try {
    const result = await API.approveOpportunity(id);
    if (result.success) {
      showToast('Trade executed!', 'success');
    } else {
      showToast(result.error || 'Failed to execute trade', 'error');
    }
    await loadOpportunities();
    await loadTrades();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function rejectOpportunity(id) {
  try {
    await API.rejectOpportunity(id);
    await loadOpportunities();
  } catch (error) {
    showToast('Failed to reject opportunity', 'error');
  }
}

async function cancelTrade(id) {
  try {
    await API.cancelTrade(id);
    showToast('Trade cancelled', 'info');
    await loadTrades();
  } catch (error) {
    showToast('Failed to cancel trade', 'error');
  }
}

// ==================== UTILITIES ====================

function formatCurrency(value) {
  const num = parseFloat(value) || 0;
  const sign = num >= 0 ? '' : '-';
  return `${sign}$${Math.abs(num).toFixed(4)}`;
}

function formatTime(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
