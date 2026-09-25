'use strict';

/**
 * 数据库：打开 SQLite、建表、写入初始数据
 * 表结构见 docs/通信协议.md 与根 README
 */

const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./driver');
const config = require('../config');

if (config.dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
}

const db = openDatabase(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

if (db.impl === 'node:sqlite') {
  console.log('[Mythclass] 正在用 Node 自带的 node:sqlite。想换成 better-sqlite3 就 npm i better-sqlite3。');
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',      -- active / banned
  token_version INTEGER NOT NULL DEFAULT 1,
  last_login_at DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME
);

CREATE TABLE IF NOT EXISTS clients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uid     TEXT UNIQUE NOT NULL,
  name           TEXT,
  owner_user_id  INTEGER,
  os             TEXT,
  version        TEXT,
  last_ip        TEXT,
  last_seen      DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS bindings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  client_id  INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, client_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS file_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL,
  timestamp  DATETIME NOT NULL,
  operation  TEXT NOT NULL,
  file_path  TEXT,
  file_size  INTEGER,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_file_logs_client_time ON file_logs (client_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS audio_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL,
  timestamp    DATETIME NOT NULL,
  process_name TEXT,
  title        TEXT,
  volume       INTEGER,
  state        TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audio_logs_client_time ON audio_logs (client_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL UNIQUE,
  max_log_count INTEGER,
  max_log_size  INTEGER,
  updated_at    DATETIME,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS client_errors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER,
  client_uid TEXT,
  kind       TEXT,
  message    TEXT,
  detail     TEXT,
  version    TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL DEFAULT 'admin',
  password_hash TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// 小迁移：老库补列。SQLite 没有 IF NOT EXISTS 的 ADD COLUMN，只能试着加、错了就算
try {
  db.exec('ALTER TABLE clients ADD COLUMN local_ips TEXT');
  console.log('[Mythclass] clients 表补了 local_ips 列');
} catch (_) {
  /* 已经有了 */
}

// 本机局域网密钥：教师端拼「带密钥的直连链接」要用
try {
  db.exec('ALTER TABLE clients ADD COLUMN lan_key TEXT');
  console.log('[Mythclass] clients 表补了 lan_key 列');
} catch (_) {
  /* 已经有了 */
}

// 初始数据（只在缺失时插入，不覆盖已有值）
const seed = db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
seed.run('registration_open', 'true');
seed.run('admin_initialized', 'false');

/** 读取一个系统设置项 */
function getSystemSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/** 写入一个系统设置项 */
function setSystemSetting(key, value) {
  db.prepare(
    'INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

function countAdmins() {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
}

module.exports = { db, getSystemSetting, setSystemSetting, countAdmins };
