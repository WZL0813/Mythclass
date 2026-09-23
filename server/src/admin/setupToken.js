'use strict';

/**
 * Admin 首次初始化令牌
 * 只在服务端本地文件出现，不通过网络下发、不打印内容、不提交 Git。
 */

const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { countAdmins, setSystemSetting } = require('../db');

const TOKEN_FILE = config.setupTokenFile;

function generateSetupToken() {
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  setSystemSetting('admin_initialized', 'false');
  console.log('[Mythclass] Admin setup token generated. Check ./data/admin-setup-token.txt');
  return token;
}

function readSetupToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch (_) {
    return null;
  }
}

function clearSetupToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch (_) {
    /* 已经不在了就算了 */
  }
  setSystemSetting('admin_initialized', 'true');
}

/** 启动时调用：没有管理员又没有令牌文件，就补一份 */
function ensureSetupToken() {
  if (countAdmins() > 0) {
    clearSetupToken();
    return null;
  }
  const existing = readSetupToken();
  if (existing) return existing;
  return generateSetupToken();
}

module.exports = { generateSetupToken, readSetupToken, clearSetupToken, ensureSetupToken, TOKEN_FILE };
