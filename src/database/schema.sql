-- Settings (single row, updated in place)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    position_size REAL DEFAULT 0.5,
    profit_threshold REAL DEFAULT 0.01,
    auto_mode INTEGER DEFAULT 0,
    kill_switch INTEGER DEFAULT 0,
    daily_loss_limit REAL DEFAULT 50.0,
    max_open_positions INTEGER DEFAULT 10,
    active_currencies TEXT DEFAULT '["BTC","ETH"]',
    scan_interval_ms INTEGER DEFAULT 5000,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Initialize settings row if not exists
INSERT OR IGNORE INTO settings (id) VALUES (1);

-- Trades history
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL,
    market_question TEXT,
    yes_token_id TEXT NOT NULL,
    no_token_id TEXT NOT NULL,
    yes_order_id TEXT,
    no_order_id TEXT,
    yes_price REAL NOT NULL,
    no_price REAL NOT NULL,
    total_cost REAL NOT NULL,
    position_size REAL NOT NULL,
    expected_profit REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    settlement_result TEXT,
    actual_profit REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    settled_at DATETIME
);

-- Pending approvals (for semi-auto mode)
CREATE TABLE IF NOT EXISTS pending_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL,
    market_question TEXT,
    yes_token_id TEXT NOT NULL,
    no_token_id TEXT NOT NULL,
    yes_price REAL NOT NULL,
    no_price REAL NOT NULL,
    spread REAL NOT NULL,
    expected_profit REAL NOT NULL,
    expires_at DATETIME,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Order book snapshots (for analysis)
CREATE TABLE IF NOT EXISTS order_book_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    token_type TEXT NOT NULL,
    best_bid REAL,
    best_ask REAL,
    bid_depth REAL,
    ask_depth REAL,
    spread REAL,
    snapshot_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Daily P&L tracking
CREATE TABLE IF NOT EXISTS daily_pnl (
    date TEXT PRIMARY KEY,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    total_invested REAL DEFAULT 0,
    total_returned REAL DEFAULT 0,
    realized_pnl REAL DEFAULT 0,
    unrealized_pnl REAL DEFAULT 0
);

-- Alerts/notifications
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    message TEXT NOT NULL,
    data TEXT,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_approvals(status);
CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_approvals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_market ON order_book_snapshots(market_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(read, created_at DESC);
