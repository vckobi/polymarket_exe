/**
 * Database module
 * SQLite database setup and repository functions
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

let db = null;

/**
 * Initialize the database connection and create tables
 */
function initDatabase() {
  // Ensure data directory exists
  const dbDir = path.dirname(config.database.path);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(config.database.path);
  db.pragma('journal_mode = WAL');

  // Read and execute schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  console.log('[Database] Initialized at', config.database.path);
  return db;
}

/**
 * Get database instance
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ==================== SETTINGS REPOSITORY ====================

const settingsRepo = {
  get() {
    const row = getDb().prepare('SELECT * FROM settings WHERE id = 1').get();
    if (row) {
      row.active_currencies = JSON.parse(row.active_currencies || '[]');
      row.auto_mode = Boolean(row.auto_mode);
      row.kill_switch = Boolean(row.kill_switch);
    }
    return row;
  },

  update(settings) {
    const fields = [];
    const values = [];

    if (settings.position_size !== undefined) {
      fields.push('position_size = ?');
      values.push(settings.position_size);
    }
    if (settings.profit_threshold !== undefined) {
      fields.push('profit_threshold = ?');
      values.push(settings.profit_threshold);
    }
    if (settings.auto_mode !== undefined) {
      fields.push('auto_mode = ?');
      values.push(settings.auto_mode ? 1 : 0);
    }
    if (settings.kill_switch !== undefined) {
      fields.push('kill_switch = ?');
      values.push(settings.kill_switch ? 1 : 0);
    }
    if (settings.daily_loss_limit !== undefined) {
      fields.push('daily_loss_limit = ?');
      values.push(settings.daily_loss_limit);
    }
    if (settings.max_open_positions !== undefined) {
      fields.push('max_open_positions = ?');
      values.push(settings.max_open_positions);
    }
    if (settings.active_currencies !== undefined) {
      fields.push('active_currencies = ?');
      values.push(JSON.stringify(settings.active_currencies));
    }
    if (settings.scan_interval_ms !== undefined) {
      fields.push('scan_interval_ms = ?');
      values.push(settings.scan_interval_ms);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');

    if (fields.length > 1) {
      const sql = `UPDATE settings SET ${fields.join(', ')} WHERE id = 1`;
      getDb().prepare(sql).run(...values);
    }

    return this.get();
  }
};

// ==================== TRADES REPOSITORY ====================

const tradesRepo = {
  create(trade) {
    const sql = `
      INSERT INTO trades (
        market_id, market_question, yes_token_id, no_token_id,
        yes_order_id, no_order_id, yes_price, no_price,
        total_cost, position_size, expected_profit, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = getDb().prepare(sql).run(
      trade.market_id,
      trade.market_question,
      trade.yes_token_id,
      trade.no_token_id,
      trade.yes_order_id || null,
      trade.no_order_id || null,
      trade.yes_price,
      trade.no_price,
      trade.total_cost,
      trade.position_size,
      trade.expected_profit,
      trade.status || 'pending'
    );
    return this.getById(result.lastInsertRowid);
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM trades WHERE id = ?').get(id);
  },

  update(id, updates) {
    const fields = [];
    const values = [];

    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (fields.length > 0) {
      values.push(id);
      const sql = `UPDATE trades SET ${fields.join(', ')} WHERE id = ?`;
      getDb().prepare(sql).run(...values);
    }

    return this.getById(id);
  },

  getAll(limit = 100, offset = 0) {
    return getDb()
      .prepare('SELECT * FROM trades ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
  },

  getActive() {
    return getDb()
      .prepare("SELECT * FROM trades WHERE status IN ('pending', 'placed', 'partial') ORDER BY created_at DESC")
      .all();
  },

  countOpen() {
    const result = getDb()
      .prepare("SELECT COUNT(*) as count FROM trades WHERE status IN ('pending', 'placed', 'partial')")
      .get();
    return result.count;
  },

  getByStatus(status) {
    return getDb()
      .prepare('SELECT * FROM trades WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
};

// ==================== PENDING APPROVALS REPOSITORY ====================

const pendingRepo = {
  create(opportunity) {
    const sql = `
      INSERT INTO pending_approvals (
        market_id, market_question, yes_token_id, no_token_id,
        yes_price, no_price, spread, expected_profit, expires_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;
    const result = getDb().prepare(sql).run(
      opportunity.market_id,
      opportunity.market_question,
      opportunity.yes_token_id,
      opportunity.no_token_id,
      opportunity.yes_price,
      opportunity.no_price,
      opportunity.spread,
      opportunity.expected_profit,
      opportunity.expires_at || null
    );
    return this.getById(result.lastInsertRowid);
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM pending_approvals WHERE id = ?').get(id);
  },

  getPending() {
    return getDb()
      .prepare("SELECT * FROM pending_approvals WHERE status = 'pending' ORDER BY created_at DESC")
      .all();
  },

  updateStatus(id, status) {
    getDb().prepare('UPDATE pending_approvals SET status = ? WHERE id = ?').run(status, id);
    return this.getById(id);
  },

  expireOld() {
    getDb()
      .prepare("UPDATE pending_approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')")
      .run();
  },

  deleteAll() {
    getDb().prepare("DELETE FROM pending_approvals WHERE status = 'pending'").run();
  }
};

// ==================== ORDER BOOK SNAPSHOTS REPOSITORY ====================

const snapshotsRepo = {
  create(snapshot) {
    const sql = `
      INSERT INTO order_book_snapshots (
        market_id, token_id, token_type, best_bid, best_ask, bid_depth, ask_depth, spread
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    getDb().prepare(sql).run(
      snapshot.market_id,
      snapshot.token_id,
      snapshot.token_type,
      snapshot.best_bid,
      snapshot.best_ask,
      snapshot.bid_depth,
      snapshot.ask_depth,
      snapshot.spread
    );
  },

  getByMarket(marketId, limit = 100) {
    return getDb()
      .prepare('SELECT * FROM order_book_snapshots WHERE market_id = ? ORDER BY snapshot_at DESC LIMIT ?')
      .all(marketId, limit);
  },

  cleanup(daysOld = 7) {
    getDb()
      .prepare(`DELETE FROM order_book_snapshots WHERE snapshot_at < datetime('now', '-${daysOld} days')`)
      .run();
  }
};

// ==================== DAILY P&L REPOSITORY ====================

const pnlRepo = {
  getToday() {
    const today = new Date().toISOString().split('T')[0];
    return getDb().prepare('SELECT * FROM daily_pnl WHERE date = ?').get(today);
  },

  getRange(startDate, endDate) {
    return getDb()
      .prepare('SELECT * FROM daily_pnl WHERE date BETWEEN ? AND ? ORDER BY date DESC')
      .all(startDate, endDate);
  },

  upsert(date, updates) {
    const existing = getDb().prepare('SELECT * FROM daily_pnl WHERE date = ?').get(date);

    if (existing) {
      const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = Object.values(updates);
      values.push(date);
      getDb().prepare(`UPDATE daily_pnl SET ${fields} WHERE date = ?`).run(...values);
    } else {
      const fields = ['date', ...Object.keys(updates)];
      const placeholders = fields.map(() => '?').join(', ');
      const values = [date, ...Object.values(updates)];
      getDb().prepare(`INSERT INTO daily_pnl (${fields.join(', ')}) VALUES (${placeholders})`).run(...values);
    }

    return getDb().prepare('SELECT * FROM daily_pnl WHERE date = ?').get(date);
  },

  incrementTrades(date, profit) {
    const existing = this.getToday();
    if (existing) {
      getDb().prepare(`
        UPDATE daily_pnl SET
          total_trades = total_trades + 1,
          winning_trades = winning_trades + ?,
          realized_pnl = realized_pnl + ?
        WHERE date = ?
      `).run(profit > 0 ? 1 : 0, profit, date);
    } else {
      this.upsert(date, {
        total_trades: 1,
        winning_trades: profit > 0 ? 1 : 0,
        realized_pnl: profit
      });
    }
  }
};

// ==================== ALERTS REPOSITORY ====================

const alertsRepo = {
  create(alert) {
    const sql = `
      INSERT INTO alerts (type, severity, message, data)
      VALUES (?, ?, ?, ?)
    `;
    const result = getDb().prepare(sql).run(
      alert.type,
      alert.severity || 'info',
      alert.message,
      alert.data ? JSON.stringify(alert.data) : null
    );
    return this.getById(result.lastInsertRowid);
  },

  getById(id) {
    const row = getDb().prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    if (row && row.data) {
      row.data = JSON.parse(row.data);
    }
    return row;
  },

  getAll(limit = 50, offset = 0) {
    const rows = getDb()
      .prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
    return rows.map(row => {
      if (row.data) row.data = JSON.parse(row.data);
      return row;
    });
  },

  getUnread() {
    const rows = getDb()
      .prepare('SELECT * FROM alerts WHERE read = 0 ORDER BY created_at DESC')
      .all();
    return rows.map(row => {
      if (row.data) row.data = JSON.parse(row.data);
      return row;
    });
  },

  markRead(id) {
    getDb().prepare('UPDATE alerts SET read = 1 WHERE id = ?').run(id);
  },

  markAllRead() {
    getDb().prepare('UPDATE alerts SET read = 1 WHERE read = 0').run();
  },

  countUnread() {
    const result = getDb().prepare('SELECT COUNT(*) as count FROM alerts WHERE read = 0').get();
    return result.count;
  }
};

module.exports = {
  initDatabase,
  getDb,
  settings: settingsRepo,
  trades: tradesRepo,
  pending: pendingRepo,
  snapshots: snapshotsRepo,
  pnl: pnlRepo,
  alerts: alertsRepo
};
