/**
 * API Client
 * HTTP requests to the bot API
 */

const API = {
  baseUrl: '/api',

  async request(method, endpoint, data = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, options);
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || 'Request failed');
      }

      return json;
    } catch (error) {
      console.error(`API Error: ${method} ${endpoint}`, error);
      throw error;
    }
  },

  // Settings
  async getSettings() {
    return this.request('GET', '/settings');
  },

  async updateSettings(settings) {
    return this.request('PUT', '/settings', settings);
  },

  async toggleKillSwitch() {
    return this.request('POST', '/kill-switch');
  },

  // Trades
  async getTrades(limit = 100, offset = 0) {
    return this.request('GET', `/trades?limit=${limit}&offset=${offset}`);
  },

  async getActiveTrades() {
    return this.request('GET', '/trades/active');
  },

  async cancelTrade(tradeId) {
    return this.request('POST', `/trades/${tradeId}/cancel`);
  },

  // Opportunities
  async getOpportunities() {
    return this.request('GET', '/opportunities');
  },

  async approveOpportunity(id) {
    return this.request('POST', `/opportunities/${id}/approve`);
  },

  async rejectOpportunity(id) {
    return this.request('POST', `/opportunities/${id}/reject`);
  },

  // Markets
  async getMarkets() {
    return this.request('GET', '/markets');
  },

  async getOrderBook(yesTokenId, noTokenId) {
    return this.request('GET', `/orderbook/${yesTokenId}/${noTokenId}`);
  },

  // Stats
  async getStats() {
    return this.request('GET', '/stats');
  },

  async getPnLHistory(days = 30) {
    return this.request('GET', `/stats/pnl?days=${days}`);
  },

  async getBalance() {
    return this.request('GET', '/balance');
  },

  async getRiskStatus() {
    return this.request('GET', '/risk');
  },

  // Alerts
  async getAlerts(limit = 50) {
    return this.request('GET', `/alerts?limit=${limit}`);
  },

  async getUnreadCount() {
    return this.request('GET', '/alerts/unread');
  },

  async markAlertRead(id) {
    return this.request('POST', `/alerts/${id}/read`);
  },

  async markAllAlertsRead() {
    return this.request('POST', '/alerts/read-all');
  }
};
