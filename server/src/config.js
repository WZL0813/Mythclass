'use strict';

/**
 * 服务端配置加载
 * 优先级：环境变量(.env) > config.json > 自动生成的运行时密钥
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return {};
  }
}

const fileCfg = readJson(path.join(ROOT, 'config.json'));

const dataDir = path.join(ROOT, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// 没配密钥时自动生成一份并持久化，免得每次重启都把所有人踢下线
const secretsFile = path.join(dataDir, 'runtime-secrets.json');
const runtimeSecrets = readJson(secretsFile);

function pickSecret(envName, cfgKey, storeKey) {
  const fromEnv = process.env[envName];
  const fromFile = fileCfg[cfgKey];
  const usable = (v) => typeof v === 'string' && v.length >= 16 && !v.startsWith('change-me');
  if (usable(fromEnv)) return fromEnv;
  if (usable(fromFile)) return fromFile;
  if (usable(runtimeSecrets[storeKey])) return runtimeSecrets[storeKey];

  const generated = crypto.randomBytes(32).toString('hex');
  runtimeSecrets[storeKey] = generated;
  fs.writeFileSync(secretsFile, JSON.stringify(runtimeSecrets, null, 2), { mode: 0o600 });
  console.warn(
    `[Mythclass] 未检测到 ${envName}，已自动生成临时密钥（data/runtime-secrets.json）。正式部署请写进 .env。`
  );
  return generated;
}

function toOrigins(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return list.map((s) => String(s).trim()).filter(Boolean);
}

const config = {
  root: ROOT,
  dataDir,
  host: process.env.HOST || fileCfg.host || '127.0.0.1',
  port: Number(process.env.PORT || fileCfg.port || 3000),
  dbFile:
    process.env.DB_FILE ||
    fileCfg.dbFile ||
    path.join(dataDir, 'mythclass.db'),
  jwtSecret: pickSecret('JWT_SECRET', 'jwtSecret', 'jwtSecret'),
  adminJwtSecret: pickSecret('ADMIN_JWT_SECRET', 'adminJwtSecret', 'adminJwtSecret'),
  teacherTokenTtl: process.env.TEACHER_TOKEN_TTL || '7d',
  adminTokenTtl: process.env.ADMIN_TOKEN_TTL || '1h',
  clientTokenTtl: process.env.CLIENT_TOKEN_TTL || '365d',
  corsOrigins: toOrigins(
    process.env.CORS_ORIGINS ||
      fileCfg.corsOrigins ||
      'https://mythclass.ryokuryuneko.top,http://localhost:5173,http://127.0.0.1:5173'
  ),
  relayEnabled: process.env.RELAY_ENABLED
    ? process.env.RELAY_ENABLED === 'true'
    : fileCfg.relayEnabled !== false,
  fileLogMaxCount: Number(process.env.FILE_LOG_MAX_COUNT || fileCfg.fileLogMaxCount || 5000),
  fileLogMaxSize: Number(process.env.FILE_LOG_MAX_SIZE || fileCfg.fileLogMaxSize || 200 * 1024 * 1024),
  setupTokenFile: path.join(dataDir, 'admin-setup-token.txt'),
  officialServer: 'wss://mythclassapi.ryokuryuneko.top',
  brand: 'Mythclass',
  version: require('../package.json').version,
};

module.exports = config;
