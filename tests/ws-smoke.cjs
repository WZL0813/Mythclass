// WebSocket 冒烟测试（临时脚本）
const path = require('path');
const { io } = require(path.join(__dirname, '..', 'teacher', 'node_modules', 'socket.io-client'));

const BASE = process.env.BASE || 'http://127.0.0.1:3111';
let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

async function api(method, p, body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 造一个新老师
  const username = 'wsuser' + Date.now().toString().slice(-6);
  let r = await api('POST', '/api/auth/register', { username, password: 'pass1234' });
  const teacherToken = r.data.token;

  // 造一台新机器
  const uid = 'MYTH-' + Math.random().toString(16).slice(2, 6).toUpperCase() + '-AAAA-BBBB';
  r = await api('POST', '/api/client/register', { clientUid: uid, name: 'WS 测试机', os: 'Windows', version: '1.0.0' });
  const clientToken = r.data.token;
  const clientId = r.data.client.id;

  // 绑定
  r = await api('POST', '/api/auth/bind', { clientUid: uid }, teacherToken);
  check('bind for ws test', r.status === 200);

  console.log('== 握手鉴权 ==');
  const badClient = io(BASE, { path: '/socket.io', auth: { token: 'nonsense' }, reconnection: false });
  const badErr = await new Promise((resolve) => {
    badClient.on('connect_error', (err) => resolve(err.message));
    setTimeout(() => resolve('timeout'), 4000);
  });
  check('bad token rejected at handshake', badErr === 'TOKEN_INVALID', `got ${badErr}`);
  badClient.close();

  const noToken = io(BASE, { path: '/socket.io', auth: {}, reconnection: false });
  const noErr = await new Promise((resolve) => {
    noToken.on('connect_error', (err) => resolve(err.message));
    setTimeout(() => resolve('timeout'), 4000);
  });
  check('missing token rejected', noErr === 'UNAUTHORIZED', `got ${noErr}`);
  noToken.close();

  console.log('== 连接与房间 ==');
  const clientSock = io(BASE, { path: '/socket.io', auth: { token: clientToken }, reconnection: false });
  const clientRegistered = await new Promise((resolve) => {
    clientSock.on('registered', resolve);
    setTimeout(() => resolve(null), 4000);
  });
  check('client receives registered', !!clientRegistered && clientRegistered.clientId === clientId);

  const teacherSock = io(BASE, { path: '/socket.io', auth: { token: teacherToken }, reconnection: false });
  const presence = await new Promise((resolve) => {
    teacherSock.on('client:presence', resolve);
    setTimeout(() => resolve(null), 4000);
  });
  check('teacher receives presence batch on connect', !!presence && Array.isArray(presence.batch), JSON.stringify(presence));
  check('presence says online', !!(presence && presence.batch.find((x) => x.clientId === clientId && x.online)));

  const watchAck = await new Promise((resolve) => {
    teacherSock.emit('watch', { clientId }, resolve);
    setTimeout(() => resolve(null), 4000);
  });
  check('watch ack ok', !!watchAck && watchAck.ok === true && watchAck.online === true, JSON.stringify(watchAck));

  console.log('== 中继 ==');
  const framePromise = new Promise((resolve) => teacherSock.on('screen_frame', resolve));
  clientSock.emit('screen_frame', { data: 'data:image/jpeg;base64,AAAA', width: 1280, height: 720, ts: Date.now() });
  const frame = await Promise.race([framePromise, wait(4000).then(() => null)]);
  check('screen_frame relayed to teacher', !!frame && frame.width === 1280);

  const cmdPromise = new Promise((resolve) => clientSock.on('command', resolve));
  const cmdAck = await new Promise((resolve) => {
    teacherSock.emit('command', { clientId, command: 'lock', args: {}, requestId: 'r1' }, resolve);
    setTimeout(() => resolve(null), 4000);
  });
  const cmd = await Promise.race([cmdPromise, wait(4000).then(() => null)]);
  check('command delivered to client', !!cmd && cmd.command === 'lock', JSON.stringify(cmd));
  check('command ack says delivered', !!cmdAck && cmdAck.ok === true && cmdAck.delivered === true, JSON.stringify(cmdAck));

  const resultPromise = new Promise((resolve) => teacherSock.on('command_result', resolve));
  clientSock.emit('command_result', { requestId: 'r1', command: 'lock', ok: true, output: '已锁屏' });
  const result = await Promise.race([resultPromise, wait(4000).then(() => null)]);
  check('command_result relayed back', !!result && result.ok === true && result.output === '已锁屏');

  // 客户端不该收到自己发的东西
  let echoed = false;
  clientSock.on('screen_frame', () => { echoed = true; });
  clientSock.emit('screen_frame', { data: 'x', width: 1, height: 1, ts: 1 });
  await wait(600);
  check('client does not receive its own frame', echoed === false);

  console.log('== 越权 ==');
  const stranger = 'wsstranger' + Date.now().toString().slice(-6);
  r = await api('POST', '/api/auth/register', { username: stranger, password: 'pass1234' });
  const strangerSock = io(BASE, { path: '/socket.io', auth: { token: r.data.token }, reconnection: false });
  await new Promise((resolve) => strangerSock.on('connect', resolve));

  const strangerWatch = await new Promise((resolve) => {
    strangerSock.emit('watch', { clientId }, resolve);
    setTimeout(() => resolve(null), 4000);
  });
  check('stranger cannot watch', !!strangerWatch && strangerWatch.ok === false, JSON.stringify(strangerWatch));

  const strangerCmdAck = await new Promise((resolve) => {
    strangerSock.emit('command', { clientId, command: 'shutdown' }, resolve);
    setTimeout(() => resolve(null), 4000);
  });
  check('stranger cannot send command', !!strangerCmdAck && strangerCmdAck.ok === false, JSON.stringify(strangerCmdAck));

  let leaked = false;
  strangerSock.on('screen_frame', () => { leaked = true; });
  clientSock.emit('screen_frame', { data: 'x', width: 2, height: 2, ts: 2 });
  await wait(600);
  check('stranger does not receive frames', leaked === false);

  console.log('== 心跳与策略同步 ==');
  const hb = await new Promise((resolve) => {
    clientSock.emit('heartbeat');
    clientSock.on('heartbeat:ack', resolve);
    setTimeout(() => resolve(null), 4000);
  });
  check('heartbeat ack', !!hb && typeof hb.t === 'number');

  const settingsPromise = new Promise((resolve) => clientSock.on('settings:update', resolve));
  teacherSock.emit('settings:update', { clientId, settings: { maxLogCount: 999 } });
  const settings = await Promise.race([settingsPromise, wait(4000).then(() => null)]);
  check('settings:update delivered to client', !!settings && settings.settings.maxLogCount === 999);

  console.log('== 断线感知 ==');
  const offline = new Promise((resolve) => teacherSock.on('client:presence', (p) => { if (p.clientId === clientId && p.online === false) resolve(p); }));
  clientSock.close();
  const offlineEvent = await Promise.race([offline, wait(5000).then(() => null)]);
  check('offline presence pushed', !!offlineEvent);

  console.log('== 封禁强踢 ==');
  const adminLogin = await api('POST', '/api/admin/login', { username: 'admin', password: 'newadminpass' });
  const adminToken = adminLogin.data && adminLogin.data.token;
  const list = await api('GET', `/api/admin/users?q=${username}`, null, adminToken);
  const target = list.data.users.find((u) => u.username === username);
  const forced = new Promise((resolve) => teacherSock.on('force:logout', resolve));
  await api('POST', `/api/admin/users/${target.id}/ban`, null, adminToken);
  const logout = await Promise.race([forced, wait(4000).then(() => null)]);
  check('banned teacher gets force:logout', !!logout && logout.reason === 'USER_BANNED', JSON.stringify(logout));

  teacherSock.close();
  strangerSock.close();
  await wait(300);

  console.log('');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('WS 测试炸了：', err);
  process.exit(1);
});
