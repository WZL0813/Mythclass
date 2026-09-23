// Mythclass 冒烟测试（临时脚本，不属于交付物）
const BASE = process.env.BASE || 'http://127.0.0.1:3111';
let pass = 0;
let fail = 0;

async function call(method, path, body, token, adminToken) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (adminToken) headers.Authorization = `Admin-Bearer ${adminToken}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

(async () => {
  console.log('== 基础 ==');
  let r = await call('GET', '/healthz');
  check('healthz', r.status === 200 && r.data.ok);
  r = await call('GET', '/api/auth/registration-status');
  check('registration-status', r.data.open === true);

  console.log('== 教师端注册登录 ==');
  const username = 'teacher' + Date.now().toString().slice(-6);
  r = await call('POST', '/api/auth/register', { username, password: 'pass1234', email: `${username}@example.com` });
  check('register', r.status === 201 && r.data.token, JSON.stringify(r.data));
  const teacherToken = r.data.token;

  r = await call('POST', '/api/auth/login', { username, password: 'pass1234' });
  check('login', r.status === 200 && r.data.token);

  r = await call('POST', '/api/auth/login', { username, password: 'wrong' });
  check('wrong password rejected', r.status === 401);

  r = await call('GET', '/api/auth/me', null, teacherToken);
  check('me', r.status === 200 && r.data.user.username === username);

  r = await call('GET', '/api/auth/me');
  check('me without token rejected', r.status === 401);

  console.log('== 客户端 ==');
  const uid = 'MYTH-' + Math.random().toString(16).slice(2, 6).toUpperCase() + '-0001-ABCD';
  r = await call('POST', '/api/client/register', { clientUid: uid, name: '测试一体机', os: 'Windows 10', version: '1.0.0' });
  check('client register', r.status === 200 && r.data.token, JSON.stringify(r.data));
  const clientToken = r.data.token;
  const clientId = r.data.client.id;

  r = await call('POST', '/api/client/register', { clientUid: 'bad uid!' });
  check('bad client uid rejected', r.status === 400);

  r = await call('POST', '/api/client/heartbeat', null, clientToken);
  check('heartbeat', r.status === 200 && r.data.ok);

  r = await call('POST', '/api/client/file-logs', {
    logs: [
      { timestamp: '2025-09-23 10:00:00', operation: 'modified', filePath: 'C:\\a\\b.docx', fileSize: 1024 },
      { timestamp: '2025-09-23 10:01:00', operation: 'created', filePath: 'C:\\a\\c.txt', fileSize: 12 },
    ],
  }, clientToken);
  check('file-logs upload', r.status === 200 && r.data.saved === 2, JSON.stringify(r.data));

  r = await call('POST', '/api/client/audio-info', {
    items: [{ processName: 'chrome.exe', title: '测试', volume: 62, state: 'playing' }],
  }, clientToken);
  check('audio-info upload', r.status === 200);

  r = await call('POST', '/api/client/command-result', { requestId: 'x1', command: 'lock', ok: true, output: '已锁屏' }, clientToken);
  check('command-result', r.status === 200);

  console.log('== 绑定与记录 ==');
  r = await call('POST', '/api/auth/bind', { clientUid: uid, name: '高一(3)班' }, teacherToken);
  check('bind', r.status === 200 && r.data.ok, JSON.stringify(r.data));

  r = await call('GET', '/api/auth/clients', null, teacherToken);
  check('clients list', r.status === 200 && r.data.clients.length === 1 && r.data.clients[0].name === '高一(3)班');

  r = await call('GET', `/api/auth/clients/${clientId}/file-logs?limit=10&q=docx`, null, teacherToken);
  check('file-logs query', r.status === 200 && r.data.total === 1 && r.data.logs[0].operation === 'modified');

  r = await call('GET', `/api/auth/clients/${clientId}/file-logs?operation=created`, null, teacherToken);
  check('file-logs filter', r.status === 200 && r.data.total === 1);

  r = await call('GET', `/api/auth/clients/${clientId}/audio-logs`, null, teacherToken);
  check('audio-logs', r.status === 200 && r.data.logs.length === 1);

  r = await call('PUT', `/api/auth/clients/${clientId}/settings`, { maxLogCount: 1234, maxLogSize: 10485760 }, teacherToken);
  check('save settings', r.status === 200 && r.data.settings.maxLogCount === 1234);

  r = await call('GET', `/api/auth/clients/${clientId}/settings`, null, teacherToken);
  check('read settings back', r.data.settings.maxLogCount === 1234);

  r = await call('POST', `/api/auth/clients/${clientId}/command`, { command: 'lock' }, teacherToken);
  check('command via REST (offline -> not delivered)', r.status === 200 && r.data.delivered === false);

  console.log('== 越权检查 ==');
  const other = 'other' + Date.now().toString().slice(-6);
  r = await call('POST', '/api/auth/register', { username: other, password: 'pass1234' });
  const otherToken = r.data.token;
  r = await call('GET', `/api/auth/clients/${clientId}/file-logs`, null, otherToken);
  check('other user cannot read logs', r.status === 404);
  r = await call('POST', `/api/auth/clients/${clientId}/command`, { command: 'shutdown' }, otherToken);
  check('other user cannot send command', r.status === 404);
  r = await call('POST', '/api/auth/bind', { clientUid: uid }, otherToken);
  check('already bound rejected', r.status === 409);

  console.log('== Admin ==');
  r = await call('GET', '/api/admin/setup-status');
  check('setup-status', r.status === 200 && r.data.initialized === false && r.data.hasToken === true);

  const fs = require('fs');
  const path = require('path');
  const tokenFile = path.join(__dirname, '..', 'server', 'data', 'admin-setup-token.txt');
  const setupToken = fs.readFileSync(tokenFile, 'utf8').trim();

  r = await call('POST', '/api/admin/setup', { token: 'wrong-token', password: 'adminpass123', confirm: 'adminpass123' });
  check('bad setup token rejected', r.status === 403);

  r = await call('POST', '/api/admin/setup', { token: setupToken, username: 'admin', password: 'adminpass123', confirm: 'adminpass123' });
  check('admin setup', r.status === 201 && r.data.token, JSON.stringify(r.data));
  const adminToken = r.data.token;

  check('setup token file destroyed', !fs.existsSync(tokenFile));
  r = await call('POST', '/api/admin/setup', { token: setupToken, password: 'adminpass123', confirm: 'adminpass123' });
  check('setup closed after init', r.status === 409);

  r = await call('GET', '/api/admin/me', null, null, adminToken);
  check('admin me', r.status === 200 && r.data.admin.username === 'admin');

  r = await call('GET', '/api/admin/dashboard', null, null, adminToken);
  check('dashboard', r.status === 200 && r.data.clients.total >= 1 && typeof r.data.server.uptimeSeconds === 'number');

  r = await call('GET', '/api/admin/users', null, null, adminToken);
  check('admin users', r.status === 200 && r.data.total >= 2);
  const targetUser = r.data.users.find((u) => u.username === username);

  r = await call('GET', `/api/admin/users/${targetUser.id}/clients`, null, null, adminToken);
  check('admin user clients', r.status === 200 && r.data.clients.length === 1);

  r = await call('GET', '/api/admin/clients', null, null, adminToken);
  check('admin clients', r.status === 200 && r.data.total >= 1 && r.data.clients[0].ownerName === username);

  r = await call('POST', `/api/admin/users/${targetUser.id}/ban`, null, null, adminToken);
  check('ban user', r.status === 200);

  r = await call('GET', '/api/auth/me', null, teacherToken);
  check('banned user token rejected', r.status === 403, `status=${r.status}`);

  r = await call('GET', '/api/admin/users', null, null, adminToken);
  const banned = r.data.users.find((u) => u.id === targetUser.id);
  check('user marked banned', banned.status === 'banned');

  r = await call('POST', `/api/admin/users/${targetUser.id}/unban`, null, null, adminToken);
  check('unban user', r.status === 200);
  r = await call('GET', '/api/auth/me', null, teacherToken);
  check('old token still dead after unban (tv bumped)', r.status === 401, `status=${r.status}`);

  r = await call('PUT', '/api/admin/settings/registration', { open: false }, null, adminToken);
  check('close registration', r.status === 200);
  r = await call('POST', '/api/auth/register', { username: 'shouldfail1', password: 'pass1234' });
  check('register blocked when closed', r.status === 403 && r.data.error === 'REGISTRATION_CLOSED');
  r = await call('PUT', '/api/admin/settings/registration', { open: true }, null, adminToken);
  check('reopen registration', r.status === 200);

  r = await call('POST', '/api/admin/clients/' + clientId + '/unbind', null, null, adminToken);
  check('admin unbind', r.status === 200);

  r = await call('POST', `/api/admin/clients/${clientId}/rebind`, { userId: targetUser.id }, null, adminToken);
  check('admin rebind', r.status === 200);
  r = await call('GET', '/api/admin/clients', null, null, adminToken);
  check('rebind reflected', r.data.clients.find((c) => c.id === clientId).ownerUserId === targetUser.id);

  r = await call('GET', '/api/admin/settings', null, null, adminToken);
  check('admin settings', r.status === 200 && r.data.settings.registration_open === 'true');

  const res = await fetch(BASE + '/api/admin/export?type=users&format=csv', { headers: { Authorization: `Admin-Bearer ${adminToken}` } });
  const csv = await res.text();
  check('export csv', res.status === 200 && csv.includes(username));

  r = await call('POST', '/api/admin/change-password', { oldPassword: 'adminpass123', newPassword: 'newadminpass' }, null, adminToken);
  check('admin change password', r.status === 200);
  r = await call('POST', '/api/admin/login', { username: 'admin', password: 'newadminpass' });
  check('login with new admin password', r.status === 200);

  console.log('== 静态页面 ==');
  const html = await fetch(BASE + '/admin');
  const body = await html.text();
  check('admin html served', html.status === 200 && body.includes('Mythclass Admin'));

  console.log('');
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试脚本炸了：', err);
  process.exit(1);
});
