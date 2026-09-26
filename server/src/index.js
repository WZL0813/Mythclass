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
const { originAllowed, describeOrigin } = require('./middleware/origin');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true); // 前面站着 Cloudflare

// 跨域闸门：白名单 + 同源
// 同源这条不能少：Admin 后台可能从 localhost / 局域网 IP / 隧道域名打开，
// 而浏览器对 POST 一定带 Origin，只认白名单会把这种访问全拒掉。
app.use((req, res, next) => {
  if (originAllowed(req)) return next();

  console.warn(`[Mythclass] 拦下跨域请求：${describeOrigin(req)} → ${req.method} ${req.originalUrl}`);
  return res.status(403).json({
    error: 'CORS_DENIED',
    message: `跨域被拒：${describeOrigin(req)}`,
    hint: '要放行就把它加进 .env 的 CORS_ORIGINS（逗号分隔）。同源访问本来就会放行，不该走到这里。',
  });
});

app.use(cors({ origin: true, credentials: true }));
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
app.use(
  '/admin',
  express.static(adminDir, {
    index: false,
    etag: true,
    // 后台改一版就要立刻生效，别让浏览器（还有前面的 CDN）拿旧的
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    },
  })
);
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

/**
 * 部署版本标记，不需要凭证。
 *
 * 为什么要有这个：以前想确认「线上跑的是哪一版」只能靠猜 —— 例如探测
 * /api/client/teachers 拿到 401，分不清是新接口在要凭证，还是全局中间件
 * 拦下的未知路由。有了它，浏览器打开一次就知道这一版有没有某个能力。
 */
app.get('/api/meta', (req, res) => {
  res.json({
    service: 'Mythclass 服务端',
    version: '3.0.0.3',
    features: [
      'client-teachers', // 客户端可拉取绑定老师（本地网页要用）
      'local-ips', // 记录客户端上报的内网 IP
      'same-network', // 判定老师与客户端是否同一出口
      'teacher-ip-tag', // 转发消息带老师真实 IP
      'lan-key', // 存本机局域网密钥，教师端拼「带密钥的直连链接」
    ],
    time: new Date().toISOString(),
  });
});

// 教师端注册页要用，不需要登录
app.get('/api/auth/registration-status', (req, res) => {
  res.json({ open: String(getSystemSetting('registration_open', 'true')) === 'true' });
});

app.use('/api/auth', authRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: '接口不存在' }));

// 统一错误出口
app.use((err, req, res, _next) => {
  console.error('[Mythclass] 请求出错：', err.message);
  res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
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

// 启动时清一次太老的文件日志（教师端看到的就都是新的）

try {

  const n = require('./db').pruneFileLogs();

  if (n) console.log(`[Mythclass] 清理了 ${n} 条过期文件日志`);

} catch (err) {

  console.warn('[Mythclass] 文件日志清理跳过：', err.message);

}


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
