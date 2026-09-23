'use strict';

/**
 * Mythclass 服务端入口
 * 认证 / 客户端注册 / 绑定 / 信令 / 中继 / Admin 后台
 */

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const { db, getSystemSetting } = require('./db');
const sockets = require('./sockets');
const setupToken = require('./admin/setupToken');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/client');
const adminRoutes = require('./routes/admin');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true); // 前面站着 Cloudflare

app.use(
  cors({
    origin(origin, callback) {
      // 没有 Origin 的是脚本 / 客户端请求，放行
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS 拒绝：${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: false }));

// 简易访问日志
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
  next();
});

/* --------------------------- Admin 后台静态页面 --------------------------- */

const adminDir = path.join(__dirname, '..', 'public', 'admin');
app.use('/admin', express.static(adminDir, { index: false }));
app.get('/admin', (req, res) => res.sendFile(path.join(adminDir, 'index.html')));
app.get('/admin/', (req, res) => res.sendFile(path.join(adminDir, 'index.html')));

/* -------------------------------- API 路由 -------------------------------- */

app.get('/', (req, res) => {
  res.json({
    name: 'Mythclass Server',
    brand: 'Mythclass 若思班级一体机管理系统',
    version: config.version,
    official: config.officialServer,
    admin: '/admin',
    docs: 'https://github.com/WZL0813/Mythclass',
  });
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, ...sockets.stats(), db: config.dbFile });
});

// 教师端注册页要用，不需要登录
app.get('/api/auth/registration-status', (req, res) => {
  res.json({ open: String(getSystemSetting('registration_open', 'true')) === 'true' });
});

app.use('/api/auth', authRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: '接口不存在' }));

// 统一错误出口（CORS 拒绝也走这里）
app.use((err, req, res, _next) => {
  console.error('[Mythclass] 请求出错：', err.message);
  const status = /CORS/.test(err.message) ? 403 : 500;
  res.status(status).json({ error: status === 403 ? 'CORS_DENIED' : 'SERVER_ERROR', message: err.message });
});

/* --------------------------------- 启动 --------------------------------- */

const server = http.createServer(app);
sockets.init(server);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`[Mythclass] 端口 ${config.port} 被别的程序占着了。`);
    console.error('  换一个：在 .env 里改 PORT=3001，或者把占口的程序关掉。');
    console.error('  想知道是谁占的：netstat -ano | findstr :' + config.port);
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(config.port, config.host, () => {
  const token = setupToken.ensureSetupToken();

  console.log('');
  console.log('  Mythclass 若思班级一体机管理系统 · 服务端');
  console.log('  ------------------------------------------------');
  console.log(`  监听地址   http://${config.host}:${config.port}`);
  console.log(`  数据库     ${config.dbFile}`);
  console.log(`  官方域名   ${config.officialServer}`);
  console.log(`  Admin 后台 http://${config.host}:${config.port}/admin`);
  console.log(`  中继开关   ${config.relayEnabled ? '开启' : '关闭'}`);
  if (token) {
    console.log('  ⚠ 尚未初始化管理员：');
    console.log('    setup token 已写入 ./data/admin-setup-token.txt');
    console.log('    打开 /admin 填入它 + 新密码即可完成初始化');
  }
  console.log('  ------------------------------------------------');
  console.log('  不推门，也能巡课。');
  console.log('');
});

/* ------------------------------ 优雅退出 ------------------------------ */

function shutdown(signal) {
  console.log(`\n[Mythclass] 收到 ${signal}，正在收工…`);
  server.close(() => {
    try {
      db.close();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[Mythclass] 未处理的 Promise 拒绝：', err));
