/* Mythclass Admin · 前端逻辑（原生 JS，无框架） */
'use strict';

const TOKEN_KEY = 'mythclass.admin.token';
const $ = (sel) => document.querySelector(sel);

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  admin: null,
  tab: 'dashboard',
  users: { page: 1, limit: 20, q: '', status: '', total: 0 },
  clients: { page: 1, limit: 20, q: '', total: 0 },
};

/* ------------------------------- 基础工具 ------------------------------- */

function esc(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(value) {
  if (!value) return '—';
  return String(value).replace('T', ' ').slice(0, 19);
}

function fmtDuration(seconds) {
  const s = Number(seconds) || 0;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  return `${m} 分 ${s % 60} 秒`;
}

let toastTimer = null;
function toast(message, bad = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = bad ? 'toast bad' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  if (state.token) headers['Authorization'] = `Admin-Bearer ${state.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (raw) return res;
  let data = {};
  try { data = await res.json(); } catch (_) { /* 空响应 */ }

  if (!res.ok) {
    if (res.status === 401 && state.admin) logout(true);
    throw new Error(data.message || data.error || `请求失败 (${res.status})`);
  }
  return data;
}

/* -------------------------------- 弹窗 -------------------------------- */

let modalOnOk = null;

function openModal({ title, html, okText = '确定', onOk }) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-ok').textContent = okText;
  $('#modal').hidden = false;
  modalOnOk = onOk;
}

function closeModal() {
  $('#modal').hidden = true;
  modalOnOk = null;
}

$('#modal-cancel').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
$('#modal-ok').addEventListener('click', async () => {
  if (!modalOnOk) return closeModal();
  try {
    const keep = await modalOnOk($('#modal-body'));
    if (keep !== false) closeModal();
  } catch (err) {
    toast(err.message, true);
  }
});

/* ------------------------------- 视图切换 ------------------------------- */

function showLayer(name) {
  $('#view-setup').hidden = name !== 'setup';
  $('#view-login').hidden = name !== 'login';
  $('#view-app').hidden = name !== 'app';
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === tab);
  });
  ['dashboard', 'users', 'clients', 'settings', 'releases'].forEach((t) => {
    $(`#tab-${t}`).hidden = t !== tab;
  });
  $('#tab-title').textContent = {
    dashboard: '仪表盘',
    users: '用户管理',
    clients: '客户端管理',
    releases: '发布更新',
    settings: '系统设置',
  }[tab];

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'users') loadUsers();
  if (tab === 'clients') loadClients();
  if (tab === 'releases') {
    loadReleases();
    loadFiles();
  }
  if (tab === 'settings') loadSettings();
}

/* -------------------------------- 发布更新 -------------------------------- */

function relEscape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function loadReleases() {
  const table = $('#rel-table');
  if (!table) return;
  try {
    const data = await api('/releases');
    const items = data.items || [];
    table.innerHTML =
      '<thead><tr><th style="width:90px">版本</th><th>下载地址</th><th style="width:150px">发布时间</th><th style="width:110px">操作</th></tr></thead>' +
      '<tbody>' +
      (items.length
        ? items
            .map(
              (r) =>
                `<tr><td class="mono">v${relEscape(r.version)}${r.mandatory ? ' · 强制' : ''}</td>` +
                `<td class="mono small">${relEscape(r.url)}</td>` +
                `<td class="mono small">${relEscape((r.created_at || '').slice(0, 16).replace('T', ' '))}</td>` +
                `<td><button class="btn ghost small" data-del="${r.id}">删掉</button></td></tr>`
            )
            .join('')
        : '<tr><td colspan="4" class="muted">还没发布过。</td></tr>') +
      '</tbody>';
    table.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!window.confirm('删掉这条发布？删了客户端就查不到这个版本了。')) return;
        await api(`/releases/${b.dataset.del}`, { method: 'DELETE' });
        loadReleases();
      });
    });
  } catch (err) {
    table.innerHTML = `<tbody><tr><td class="muted">拉列表失败：${relEscape(err.message)}</td></tr></tbody>`;
  }
}

async function publishRelease() {
  const msg = $('#rel-msg');
  const version = $('#rel-version').value.trim();
  const url = $('#rel-url').value.trim();
  const notes = $('#rel-notes').value.trim();
  const sha256 = $('#rel-sha256').value.trim();
  const picked = $('#rel-file') ? $('#rel-file').value : '';
  const mandatory = $('#rel-mandatory').value === '1';
  const file = $('#rel-file') ? $('#rel-file').value : '';

  msg.className = 'msg';
  if (!version) {
    msg.textContent = '版本号得写';
    msg.classList.add('bad');
    return;
  }
  if (!picked && !/^https?:\/\//i.test(url)) {
    msg.textContent = '要么选一个服务端上的文件，要么填 http(s) 地址';
    msg.classList.add('bad');
    return;
  }

  try {
    const data = await api('/releases', {
      method: 'POST',
      body: { version, url, notes, sha256, mandatory, file: picked },
    });
    msg.textContent = data.message || '发布好了';
    $('#rel-version').value = '';
    $('#rel-url').value = '';
    $('#rel-notes').value = '';
    $('#rel-sha256').value = '';
    if ($('#rel-file')) $('#rel-file').value = '';
    loadReleases();
    loadFiles();
  } catch (err) {
    msg.textContent = err.message || '发布失败';
    msg.classList.add('bad');
  }
}

function wireReleases() {
  const pub = $('#rel-publish');
  const ref = $('#rel-refresh');
  if (pub) pub.addEventListener('click', publishRelease);
  if (ref) ref.addEventListener('click', loadReleases);
}

/* ------------------------------ 版本文件管理 ------------------------------ */

function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n > 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

async function loadFiles() {
  const table = $('#rel-files');
  const select = $('#rel-file');
  if (!table) return;
  try {
    const data = await api('/files');
    const items = data.items || [];
    const current = data.current || '';

    table.innerHTML =
      '<thead><tr><th>文件名</th><th style="width:90px">大小</th><th style="width:150px">放进来的时间</th><th style="width:200px">操作</th></tr></thead>' +
      '<tbody>' +
      (items.length
        ? items
            .map(
              (f) =>
                `<tr><td class="mono small">${relEscape(f.name)}${f.name === current ? ' <b>· 当前更新</b>' : ''}</td>` +
                `<td class="mono small">${humanSize(f.size)}</td>` +
                `<td class="mono small">${relEscape((f.mtime || '').slice(0, 16).replace('T', ' '))}</td>` +
                `<td><button class="btn ghost small" data-use="${relEscape(f.name)}">选为当前更新</button> ` +
                `<button class="btn ghost small" data-del="${relEscape(f.name)}">删除</button></td></tr>`
            )
            .join('')
        : '<tr><td colspan="4" class="muted">目录还是空的，先上传一个安装包。</td></tr>') +
      '</tbody>';

    table.querySelectorAll('[data-use]').forEach((b) => {
      b.addEventListener('click', () => {
        select.value = b.dataset.use;
        const m = /(\d+(?:\.\d+)+)/.exec(b.dataset.use);
        if (m) $('#rel-version').value = m[1];
        $('#rel-url').value = '';
        $('#rel-msg').textContent = '已经选中这个文件，填好版本号和说明就能发布。';
      });
    });
    table.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!window.confirm(`删掉 ${b.dataset.del}？删了客户端就下不到了。`)) return;
        await api(`/files/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
        loadFiles();
      });
    });

    // 下拉里也列一份
    select.innerHTML =
      '<option value="">— 不用服务端的文件 —</option>' +
      items.map((f) => `<option value="${relEscape(f.name)}">${relEscape(f.name)}</option>`).join('');
  } catch (err) {
    table.innerHTML = `<tbody><tr><td class="muted">拉文件列表失败：${relEscape(err.message)}</td></tr></tbody>`;
  }
}

async function uploadFile() {
  const input = $('#rel-upload');
  const msg = $('#rel-files-msg');
  const file = input.files && input.files[0];
  msg.className = 'msg';
  if (!file) {
    msg.textContent = '先选一个文件';
    msg.classList.add('bad');
    return;
  }
  if (!/\.exe$/i.test(file.name)) {
    msg.textContent = '要 .exe 安装包';
    msg.classList.add('bad');
    return;
  }
  msg.textContent = `正在上传 ${file.name}（${humanSize(file.size)}）…`;
  try {
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (state.token) headers['Authorization'] = `Admin-Bearer ${state.token}`;
    const res = await fetch(`/api/admin/files/${encodeURIComponent(file.name)}`, {
      method: 'PUT',
      headers,
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || '上传失败');
    msg.textContent = data.message || '传好了';
    input.value = '';
    loadFiles();
  } catch (err) {
    msg.textContent = err.message || '上传失败';
    msg.classList.add('bad');
  }
}

/* -------------------------------- 启动 -------------------------------- */

async function boot() {
  const status = await fetch('/api/admin/setup-status').then((r) => r.json());

  if (!status.initialized) {
    showLayer('setup');
    return;
  }

  if (state.token) {
    try {
      const me = await api('/me');
      state.admin = me.admin;
      enterApp();
      return;
    } catch (_) {
      state.token = '';
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  showLayer('login');
}

function enterApp() {
  $('#who').textContent = `${state.admin.username} · 管理员`;
  showLayer('app');
  switchTab(state.tab);
}

function logout(silent = false) {
  state.token = '';
  state.admin = null;
  localStorage.removeItem(TOKEN_KEY);
  showLayer('login');
  if (!silent) toast('已经退出了');
}

/* ------------------------------ 初始化 / 登录 ------------------------------ */

$('#form-setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  $('#setup-msg').textContent = '正在校验…';
  try {
    const data = await fetch('/api/admin/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: form.get('token'),
        username: form.get('username'),
        password: form.get('password'),
        confirm: form.get('confirm'),
      }),
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || '初始化失败');
      return d;
    });
    state.token = data.token;
    state.admin = data.admin;
    localStorage.setItem(TOKEN_KEY, data.token);
    $('#setup-msg').textContent = '';
    toast('管理员建好了，欢迎');
    enterApp();
  } catch (err) {
    $('#setup-msg').textContent = err.message;
  }
});

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  $('#login-msg').textContent = '正在登录…';
  try {
    const data = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || '登录失败');
      return d;
    });
    state.token = data.token;
    state.admin = data.admin;
    localStorage.setItem(TOKEN_KEY, data.token);
    $('#login-msg').textContent = '';
    toast('欢迎回来');
    enterApp();
  } catch (err) {
    $('#login-msg').textContent = err.message;
  }
});

$('#btn-logout').addEventListener('click', () => logout());
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* -------------------------------- 仪表盘 -------------------------------- */

async function loadDashboard() {
  try {
    const d = await api('/dashboard');
    $('#stats').innerHTML = [
      card('用户总数', d.users.total, `在线 ${d.users.online} · 封禁 ${d.users.banned}`),
      card('客户端', d.clients.total, `在线 ${d.clients.online} · 已绑定 ${d.clients.bound}`),
      card('文件记录', d.fileLogs, '条，超出上限自动清理'),
      card('注册开关', d.registrationOpen ? '开放中' : '已关闭', d.registrationOpen ? '谁都能注册' : '注册页会被拦下'),
    ].join('');

    $('#server-info').innerHTML = [
      kv('运行时间', fmtDuration(d.server.uptimeSeconds)),
      kv('WebSocket 连接', d.server.wsConnections),
      kv('内存占用', `${d.server.memoryMB} MB`),
      kv('Node 版本', d.server.node),
      kv('系统', d.server.platform),
      kv('服务端版本', `v${d.server.version}`),
    ].join('');
  } catch (err) {
    toast(err.message, true);
  }
}

function card(label, value, sub) {
  return `<div class="stat"><p class="label">${esc(label)}</p><p class="value">${esc(value)}</p><p class="sub">${esc(sub)}</p></div>`;
}
function kv(k, v) {
  return `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
}

/* -------------------------------- 用户管理 -------------------------------- */

async function loadUsers() {
  const { page, limit, q, status } = state.users;
  try {
    const d = await api(`/users?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&limit=${limit}&offset=${(page - 1) * limit}`);
    state.users.total = d.total;

    if (!d.users.length) {
      $('#user-table').innerHTML = '<tbody><tr><td>这里空空的，没人。</td></tr></tbody>';
    } else {
      $('#user-table').innerHTML = `
        <thead><tr>
          <th>ID</th><th>用户名</th><th>邮箱</th><th>状态</th><th>客户端</th>
          <th>最后登录</th><th>注册时间</th><th>操作</th>
        </tr></thead>
        <tbody>${d.users.map(userRow).join('')}</tbody>`;
      bindUserActions();
    }

    const pages = Math.max(1, Math.ceil(d.total / limit));
    $('#user-pager').innerHTML = `<button class="btn tiny" data-page="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pages} 页 · 共 ${d.total} 人</span>
      <button class="btn tiny" data-page="next" ${page >= pages ? 'disabled' : ''}>下一页</button>`;
    $('#user-pager').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        state.users.page += b.dataset.page === 'next' ? 1 : -1;
        loadUsers();
      });
    });
  } catch (err) {
    toast(err.message, true);
  }
}

function userRow(u) {
  return `<tr>
    <td>${u.id}</td>
    <td>${esc(u.username)}</td>
    <td>${esc(u.email || '—')}</td>
    <td>${u.status === 'banned' ? '<span class="pill bad">已封禁</span>' : '<span class="pill on">正常</span>'}
        ${u.online ? '<span class="pill warn">在线</span>' : ''}</td>
    <td>${u.clientCount}</td>
    <td>${fmtTime(u.lastLoginAt)}</td>
    <td>${fmtTime(u.createdAt)}</td>
    <td class="actions">
      <button class="btn tiny" data-act="clients" data-id="${u.id}" data-name="${esc(u.username)}">看机器</button>
      <button class="btn tiny" data-act="edit" data-id="${u.id}" data-name="${esc(u.username)}" data-email="${esc(u.email || '')}">编辑</button>
      <button class="btn tiny" data-act="pwd" data-id="${u.id}" data-name="${esc(u.username)}">重置密码</button>
      ${u.status === 'banned'
        ? `<button class="btn tiny" data-act="unban" data-id="${u.id}">解封</button>`
        : `<button class="btn tiny" data-act="ban" data-id="${u.id}" data-name="${esc(u.username)}">封禁</button>`}
      <button class="btn tiny danger" data-act="del" data-id="${u.id}" data-name="${esc(u.username)}">删除</button>
    </td>
  </tr>`;
}

function bindUserActions() {
  document.querySelectorAll('#user-table button[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => userAction(btn.dataset.act, btn.dataset));
  });
}

async function userAction(act, data) {
  const id = Number(data.id);
  const name = data.name || '这个用户';

  if (act === 'ban') {
    openModal({
      title: `封禁 ${name}？`,
      html: '<p class="hint">他手上的 token 会立刻作废，WebSocket 也会被掐断。</p>',
      okText: '封禁',
      onOk: async () => { await api(`/users/${id}/ban`, { method: 'POST' }); toast('已封禁'); loadUsers(); },
    });
  } else if (act === 'unban') {
    await api(`/users/${id}/unban`, { method: 'POST' });
    toast('已解封');
    loadUsers();
  } else if (act === 'del') {
    openModal({
      title: `永久删除 ${name}？`,
      html: '<p class="hint">账号、绑定关系一起没。客户端本身留着，只是没人管了。</p>',
      okText: '删除',
      onOk: async () => { await api(`/users/${id}`, { method: 'DELETE' }); toast('删掉了'); loadUsers(); },
    });
  } else if (act === 'pwd') {
    openModal({
      title: `给 ${name} 换个密码`,
      html: '<div class="field"><label>新密码（至少 6 位）</label><input id="m-pwd" type="password" minlength="6" /></div>',
      okText: '换掉',
      onOk: async () => {
        const pwd = $('#m-pwd').value;
        if (pwd.length < 6) return toast('太短了，至少 6 位', true), false;
        await api(`/users/${id}/reset-password`, { method: 'POST', body: { password: pwd } });
        toast('换好了，他得重新登录');
      },
    });
  } else if (act === 'edit') {
    openModal({
      title: `编辑 ${name}`,
      html: `<div class="field"><label>用户名</label><input id="m-name" value="${esc(data.name)}" /></div>
             <div class="field"><label>邮箱</label><input id="m-email" value="${esc(data.email || '')}" /></div>`,
      okText: '保存',
      onOk: async () => {
        await api(`/users/${id}`, { method: 'PUT', body: { username: $('#m-name').value, email: $('#m-email').value } });
        toast('改好了');
        loadUsers();
      },
    });
  } else if (act === 'clients') {
    const d = await api(`/users/${id}/clients`);
    openModal({
      title: `${name} 的一体机`,
      html: d.clients.length
        ? `<div class="list">${d.clients.map((c) => `<div><span>${esc(c.name || '未命名')} · ${esc(c.clientUid)}</span><span>${c.online ? '在线' : '离线'}</span></div>`).join('')}</div>`
        : '<p class="hint">一台都没绑。</p>',
      okText: '知道了',
      onOk: async () => {},
    });
  }
}

$('#user-search').addEventListener('click', () => {
  state.users.q = $('#user-q').value.trim();
  state.users.status = $('#user-status').value;
  state.users.page = 1;
  loadUsers();
});
$('#user-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#user-search').click(); });

$('#user-create').addEventListener('click', () => {
  openModal({
    title: '主动建个账号',
    html: `<div class="field"><label>用户名</label><input id="m-name" /></div>
           <div class="field"><label>邮箱（可留空）</label><input id="m-email" /></div>
           <div class="field"><label>初始密码（至少 6 位）</label><input id="m-pwd" type="password" /></div>`,
    okText: '建号',
    onOk: async () => {
      await api('/users', {
        method: 'POST',
        body: { username: $('#m-name').value.trim(), email: $('#m-email').value.trim(), password: $('#m-pwd').value },
      });
      toast('建好了');
      loadUsers();
    },
  });
});

/* ------------------------------ 客户端管理 ------------------------------ */

async function loadClients() {
  const { page, limit, q } = state.clients;
  try {
    const d = await api(`/clients?q=${encodeURIComponent(q)}&limit=${limit}&offset=${(page - 1) * limit}`);
    state.clients.total = d.total;

    if (!d.clients.length) {
      $('#client-table').innerHTML = '<tbody><tr><td>还没有一体机连上来。</td></tr></tbody>';
    } else {
      $('#client-table').innerHTML = `
        <thead><tr>
          <th>ID</th><th>客户端 ID</th><th>名字</th><th>归属</th><th>状态</th>
          <th>系统 / 版本</th><th>最后 IP</th><th>最后心跳</th><th>记录</th><th>操作</th>
        </tr></thead>
        <tbody>${d.clients.map(clientRow).join('')}</tbody>`;
      bindClientActions();
    }

    const pages = Math.max(1, Math.ceil(d.total / limit));
    $('#client-pager').innerHTML = `<button class="btn tiny" data-page="prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pages} 页 · 共 ${d.total} 台</span>
      <button class="btn tiny" data-page="next" ${page >= pages ? 'disabled' : ''}>下一页</button>`;
    $('#client-pager').querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        state.clients.page += b.dataset.page === 'next' ? 1 : -1;
        loadClients();
      });
    });
  } catch (err) {
    toast(err.message, true);
  }
}

function clientRow(c) {
  return `<tr>
    <td>${c.id}</td>
    <td>${esc(c.clientUid)}</td>
    <td>${esc(c.name || '未命名')}</td>
    <td>${esc(c.ownerName || '—')}</td>
    <td>${c.online ? '<span class="pill on">在线</span>' : '<span class="pill off">离线</span>'}</td>
    <td>${esc(c.os || '—')} ${c.version ? `/ ${esc(c.version)}` : ''}</td>
    <td>${esc(c.lastIp || '—')}</td>
    <td>${fmtTime(c.lastSeen)}</td>
    <td>${c.fileLogCount}</td>
    <td class="actions">
      <button class="btn tiny" data-act="detail" data-id="${c.id}">详情</button>
      <button class="btn tiny" data-act="rebind" data-id="${c.id}" data-name="${esc(c.name || c.clientUid)}">改归属</button>
      <button class="btn tiny" data-act="unbind" data-id="${c.id}" data-name="${esc(c.name || c.clientUid)}">解绑</button>
      <button class="btn tiny danger" data-act="del" data-id="${c.id}" data-name="${esc(c.name || c.clientUid)}">删除</button>
    </td>
  </tr>`;
}

function bindClientActions() {
  document.querySelectorAll('#client-table button[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => clientAction(btn.dataset.act, btn.dataset));
  });
}

async function clientAction(act, data) {
  const id = Number(data.id);
  const name = data.name || '这台机器';

  if (act === 'detail') {
    const d = await api(`/clients/${id}`);
    const c = d.client;
    openModal({
      title: `${name} 的详情`,
      html: `<div class="list">
        <div><span>客户端 ID</span><span>${esc(c.client_uid)}</span></div>
        <div><span>操作系统</span><span>${esc(c.os || '—')}</span></div>
        <div><span>客户端版本</span><span>${esc(c.version || '—')}</span></div>
        <div><span>在线状态</span><span>${d.client.online ? '在线' : '离线'}</span></div>
        <div><span>最后 IP</span><span>${esc(c.last_ip || '—')}</span></div>
        <div><span>最后心跳</span><span>${fmtTime(c.last_seen)}</span></div>
        <div><span>本地记录条数</span><span>${d.fileLogCount}</span></div>
        <div><span>最近音频</span><span>${esc(d.lastAudio ? (d.lastAudio.process_name || '未知进程') : '没有')}</span></div>
      </div>`,
      okText: '知道了',
      onOk: async () => {},
    });
  } else if (act === 'unbind') {
    openModal({
      title: `把 ${name} 解开？`,
      html: '<p class="hint">解绑后没人能看它，机器本身还在线上。</p>',
      okText: '解绑',
      onOk: async () => { await api(`/clients/${id}/unbind`, { method: 'POST' }); toast('解开了'); loadClients(); },
    });
  } else if (act === 'del') {
    openModal({
      title: `删掉 ${name} 的记录？`,
      html: '<p class="hint">这台机器的文件记录也会一起消失。它下次启动会当成新机器重新注册。</p>',
      okText: '删除',
      onOk: async () => { await api(`/clients/${id}`, { method: 'DELETE' }); toast('删掉了'); loadClients(); },
    });
  } else if (act === 'rebind') {
    const users = await api('/users?limit=200');
    const options = users.users.map((u) => `<option value="${u.id}">${esc(u.username)} (#${u.id})</option>`).join('');
    openModal({
      title: `把 ${name} 交给谁`,
      html: `<div class="field"><label>目标用户</label><select id="m-user">${options}</select></div>`,
      okText: '换归属',
      onOk: async () => {
        await api(`/clients/${id}/rebind`, { method: 'POST', body: { userId: Number($('#m-user').value) } });
        toast('换好了');
        loadClients();
      },
    });
  }
}

$('#client-search').addEventListener('click', () => {
  state.clients.q = $('#client-q').value.trim();
  state.clients.page = 1;
  loadClients();
});
$('#client-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#client-search').click(); });

/* -------------------------------- 系统设置 -------------------------------- */

async function loadSettings() {
  try {
    const d = await api('/settings');
    $('#reg-toggle').checked = d.settings.registration_open === 'true';
  } catch (err) {
    toast(err.message, true);
  }
}

$('#reg-toggle').addEventListener('change', async (e) => {
  try {
    const d = await api('/settings/registration', { method: 'PUT', body: { open: e.target.checked } });
    toast(d.registrationOpen ? '注册开着了' : '注册关掉了');
  } catch (err) {
    e.target.checked = !e.target.checked;
    toast(err.message, true);
  }
});

$('#form-admin-pwd').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    await api('/change-password', {
      method: 'POST',
      body: { oldPassword: form.get('oldPassword'), newPassword: form.get('newPassword') },
    });
    e.target.reset();
    toast('密码换好了，下次用它登录');
  } catch (err) {
    toast(err.message, true);
  }
});

document.querySelectorAll('button[data-export]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    try {
      const res = await api(`/export?type=${btn.dataset.export}&format=${btn.dataset.format}`, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mythclass-${btn.dataset.export}.${btn.dataset.format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message, true);
    }
  });
});

/* --------------------------------- 起飞 --------------------------------- */

boot().catch((err) => {
  console.error(err);
  showLayer('login');
  $('#login-msg').textContent = '连不上服务端，检查一下它是不是没跑。';
});

wireReleases();

function wireReleaseFiles() {
  const up = $('#rel-upload-btn');
  const ref = $('#rel-files-refresh');
  if (up) up.addEventListener('click', uploadFile);
  if (ref) ref.addEventListener('click', loadFiles);
}

wireReleaseFiles();
