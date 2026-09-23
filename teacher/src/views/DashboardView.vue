<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import { api, OFFICIAL_SERVER, SERVER_URL } from '@/api';

const router = useRouter();
const auth = useAuthStore();

/* --------------------------------- 状态 --------------------------------- */

const tab = ref('screen');
const selectedId = ref(null);
const loading = ref(true);

const frameSrc = ref('');
const frameFps = ref(0);
const frameSize = ref('');
const scale = ref(1);
const controlMode = ref(false);
const screenOn = ref(false);

const audioLatest = ref(null);
const audioLogs = ref([]);

const fileLogs = ref([]);
const fileTotal = ref(0);
const fileQuery = ref('');
const fileOperation = ref('');
const filePage = ref(1);
const fileLimit = 30;

const settings = ref({ maxLogCount: 5000, maxLogSize: 209715200 });
const commandLog = ref([]);

const bindDialog = ref({ open: false, uid: '', name: '', busy: false });
const textDialog = ref({ open: false, kind: 'message', title: '', value: '', placeholder: '' });
const stage = ref(null); // 屏幕舞台 DOM

let lastFrameAt = 0;
let lastMoveSent = 0;
let movePending = null;

/* --------------------------------- 计算 --------------------------------- */

const clients = computed(() => auth.clients);
const selected = computed(() => clients.value.find((c) => c.id === selectedId.value) || null);
const selectedOnline = computed(() => (selected.value ? !!auth.presence[selected.value.id] : false));

const tabs = [
  { key: 'screen', label: '屏幕', icon: 'ph:monitor' },
  { key: 'audio', label: '音频', icon: 'ph:speaker-high' },
  { key: 'files', label: '文件记录', icon: 'ph:file-text' },
  { key: 'command', label: '命令', icon: 'ph:terminal-window' },
  { key: 'settings', label: '设置', icon: 'ph:sliders-horizontal' },
];

const commands = [
  { key: 'lock', label: '锁屏', icon: 'ph:lock', args: [] },
  { key: 'unlock', label: '解锁', icon: 'ph:lock-open', args: [] },
  { key: 'shutdown', label: '关机', icon: 'ph:power', args: [], danger: true },
  { key: 'reboot', label: '重启', icon: 'ph:arrows-clockwise', args: [], danger: true },
  { key: 'logout', label: '注销', icon: 'ph:sign-out', args: [], danger: true },
  { key: 'message', label: '弹消息', icon: 'ph:chat-centered-text', args: ['text'] },
  { key: 'open_url', label: '开网页', icon: 'ph:globe', args: ['url'] },
  { key: 'open_app', label: '开程序', icon: 'ph:app-window', args: ['path'] },
  { key: 'file_distribute', label: '发文件', icon: 'ph:paper-plane-tilt', args: ['url', 'path'] },
  { key: 'screen_broadcast', label: '屏幕广播', icon: 'ph:broadcast', args: ['url'] },
  { key: 'net_ban', label: '禁止上网', icon: 'ph:prohibit', args: ['enable'] },
];

/* -------------------------------- 启动/收尾 -------------------------------- */

onMounted(async () => {
  try {
    if (!auth.user) await auth.fetchMe();
  } catch (err) {
    ElMessage.error(err.message);
  }

  try {
    await auth.fetchClients();
    if (clients.value.length) selectClient(clients.value[0]);
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }

  auth.openSocket({
    onFrame: (payload) => {
      if (!payload || payload.clientId !== selectedId.value) return;
      if (payload.data) frameSrc.value = payload.data;
      if (payload.width) frameSize.value = `${payload.width}×${payload.height}`;

      const now = performance.now();
      if (lastFrameAt) {
        const gap = now - lastFrameAt;
        if (gap > 0) frameFps.value = Math.round(Math.min(1000 / gap, 60));
      }
      lastFrameAt = now;
    },
    onAudio: (payload) => {
      if (!payload || payload.clientId !== selectedId.value) return;
      const first = (payload.items || [])[0];
      if (first) audioLatest.value = first;
    },
    onFileLog: (payload) => {
      if (!payload || payload.clientId !== selectedId.value) return;
      fileLogs.value = [...(payload.logs || []), ...fileLogs.value].slice(0, 200);
      fileTotal.value += (payload.logs || []).length;
    },
    onCommandResult: (payload) => {
      if (!payload || payload.clientId !== selectedId.value) return;
      commandLog.value.unshift(payload);
      if (commandLog.value.length > 40) commandLog.value.pop();
      ElMessage[payload.ok ? 'success' : 'warning'](
        `${payload.command || '命令'}：${payload.ok ? '已执行' : '失败了'}`
      );
    },
  });
});

onBeforeUnmount(() => {
  if (selectedId.value && screenOn.value) auth.sendCommand(selectedId.value, 'screen_stop');
  auth.unwatchClient(selectedId.value);
});

/* -------------------------------- 客户端操作 -------------------------------- */

function selectClient(client) {
  if (selectedId.value === client.id) return;
  if (selectedId.value) {
    if (screenOn.value) auth.sendCommand(selectedId.value, 'screen_stop');
    auth.unwatchClient(selectedId.value);
  }

  selectedId.value = client.id;
  frameSrc.value = '';
  frameFps.value = 0;
  frameSize.value = '';
  audioLatest.value = null;
  audioLogs.value = [];
  fileLogs.value = [];
  fileTotal.value = 0;
  filePage.value = 1;
  commandLog.value = [];
  screenOn.value = false;

  auth.watchClient(client.id);
  loadSettings();
  loadFiles();
  loadAudio();
  if (tab.value === 'screen') startScreen();
}

async function startScreen() {
  if (!selectedId.value || screenOn.value) return;
  const ack = await auth.sendCommand(selectedId.value, 'screen_start', { fps: 12, quality: 60 });
  if (ack && ack.ok) {
    screenOn.value = true;
  } else {
    ElMessage.warning('没连上，可能机器离线。');
  }
}

function stopScreen() {
  if (selectedId.value) auth.sendCommand(selectedId.value, 'screen_stop');
  screenOn.value = false;
  frameSrc.value = '';
}

function switchTab(key) {
  const prev = tab.value;
  tab.value = key;
  if (prev === 'screen' && key !== 'screen') stopScreen();
  if (key === 'screen') startScreen();
  if (key === 'files') loadFiles();
  if (key === 'audio') loadAudio();
  if (key === 'settings') loadSettings();
}

/* -------------------------------- 屏幕操作 -------------------------------- */

function toggleFullscreen() {
  if (!stage.value) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.value.requestFullscreen?.();
}

function screenshot() {
  if (!frameSrc.value) return ElMessage.warning('还没有画面。');
  const a = document.createElement('a');
  a.href = frameSrc.value;
  a.download = `${selected.value.name || 'mythclass'}-${Date.now()}.jpg`;
  a.click();
}

/* 远程控制：坐标归一化后发过去 */
function onMove(e) {
  if (!controlMode.value || !selectedOnline.value) return;
  const now = performance.now();
  const box = e.currentTarget.getBoundingClientRect();
  const payload = {
    type: 'mousemove',
    x: Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1),
    y: Math.min(Math.max((e.clientY - box.top) / box.height, 0), 1),
  };
  if (now - lastMoveSent < 50) {
    movePending = payload;
    return;
  }
  lastMoveSent = now;
  auth.sendControl(selectedId.value, payload);
}

function onMoveFlush() {
  if (movePending) {
    auth.sendControl(selectedId.value, movePending);
    movePending = null;
  }
}

function onMouse(type) {
  if (!controlMode.value || !selectedOnline.value) return;
  return (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    auth.sendControl(selectedId.value, {
      type,
      button: e.button === 2 ? 'right' : 'left',
      x: Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1),
      y: Math.min(Math.max((e.clientY - box.top) / box.height, 0), 1),
    });
  };
}

function onKey(e) {
  if (!controlMode.value || !selectedOnline.value) return;
  e.preventDefault();
  auth.sendControl(selectedId.value, { type: 'key', key: e.key, code: e.code });
}

/* -------------------------------- 数据加载 -------------------------------- */

async function loadFiles() {
  if (!selectedId.value) return;
  try {
    const data = await api.fileLogs(selectedId.value, {
      limit: fileLimit,
      offset: (filePage.value - 1) * fileLimit,
      q: fileQuery.value,
      operation: fileOperation.value,
    });
    fileLogs.value = data.logs;
    fileTotal.value = data.total;
  } catch (err) {
    ElMessage.error(err.message);
  }
}

function searchFiles() {
  filePage.value = 1;
  loadFiles();
}

function changePage(delta) {
  const next = filePage.value + delta;
  if (next < 1) return;
  if (next > Math.max(1, Math.ceil(fileTotal.value / fileLimit))) return;
  filePage.value = next;
  loadFiles();
}

async function clearFiles() {
  try {
    await ElMessageBox.confirm('这些记录删了就找不回来了。', '确定清空？', {
      confirmButtonText: '清空',
      cancelButtonText: '算了',
      type: 'warning',
    });
    const data = await api.clearFileLogs(selectedId.value);
    ElMessage.success(`清掉了 ${data.removed} 条`);
    filePage.value = 1;
    loadFiles();
  } catch (_) {
    /* 用户取消 */
  }
}

function exportFiles() {
  if (!fileLogs.value.length) return ElMessage.warning('没东西可导。');
  const header = ['时间', '操作', '文件路径', '大小(字节)'];
  const rows = fileLogs.value.map((l) => [l.timestamp, l.operation, l.file_path, l.file_size]);
  const escape = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mythclass-文件记录-${selected.value?.name || selectedId.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadAudio() {
  if (!selectedId.value) return;
  try {
    const data = await api.audioLogs(selectedId.value, 40);
    audioLogs.value = data.logs;
    if (!audioLatest.value && data.logs.length) audioLatest.value = data.logs[0];
  } catch (err) {
    ElMessage.error(err.message);
  }
}

async function loadSettings() {
  if (!selectedId.value) return;
  try {
    const data = await api.getSettings(selectedId.value);
    settings.value = data.settings;
  } catch (_) {
    /* 静默 */
  }
}

async function saveSettings() {
  try {
    await api.saveSettings(selectedId.value, settings.value);
    ElMessage.success('两边都改了。');
  } catch (err) {
    ElMessage.error(err.message);
  }
}

/* -------------------------------- 命令面板 -------------------------------- */

async function runCommand(cmd) {
  if (!selectedId.value) return;
  if (!selectedOnline.value) return ElMessage.warning('这台机器离线呢。');

  if (cmd.key === 'screen_start') return startScreen();

  if (cmd.key === 'lock' || cmd.key === 'unlock') {
    return sendPlain(cmd.key);
  }
  if (cmd.key === 'shutdown' || cmd.key === 'reboot' || cmd.key === 'logout') {
    try {
      await ElMessageBox.confirm(`真要${cmd.label}吗？`, '确认一下', {
        confirmButtonText: cmd.label,
        cancelButtonText: '算了',
        type: 'warning',
      });
    } catch (_) {
      return;
    }
    return sendPlain(cmd.key);
  }

  const needs = cmd.args[0];
  textDialog.value = {
    open: true,
    kind: cmd.key,
    title: cmd.label,
    value: '',
    placeholder: {
      text: '要显示的话，比如：下课把窗关上',
      url: '要打开的网址，比如：https://example.com',
      path: '程序路径，比如：C:\\Windows\\notepad.exe',
      enable: '填 true 禁网，填 false 恢复',
    }[needs] || '',
  };
}

function sendPlain(command, args = {}) {
  auth.sendCommand(selectedId.value, command, args);
}

async function confirmDialog() {
  const d = textDialog.value;
  const value = d.value.trim();
  if (!value) return ElMessage.warning('先填点东西。');

  const map = {
    message: { command: 'message', args: { text: value } },
    open_url: { command: 'open_url', args: { url: value } },
    open_app: { command: 'open_app', args: { path: value } },
    file_distribute: { command: 'file_distribute', args: { url: value } },
    screen_broadcast: { command: 'screen_broadcast', args: { url: value } },
    net_ban: { command: 'net_ban', args: { enable: value === 'true' } },
  };
  const payload = map[d.kind];
  d.open = false;
  const ack = await auth.sendCommand(selectedId.value, payload.command, payload.args);
  if (!ack || !ack.ok) ElMessage.warning('没送出去，机器可能刚好掉线。');
}

/* -------------------------------- 绑定与设置 -------------------------------- */

async function bind() {
  if (!bindDialog.value.uid.trim()) return ElMessage.warning('机器 ID 得填。');
  bindDialog.value.busy = true;
  try {
    await api.bindClient({ clientUid: bindDialog.value.uid.trim(), name: bindDialog.value.name.trim() });
    ElMessage.success('绑上了。');
    bindDialog.value = { open: false, uid: '', name: '', busy: false };
    await auth.fetchClients();
    if (clients.value.length) selectClient(clients.value[0]);
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    bindDialog.value.busy = false;
  }
}

async function rename() {
  try {
    const { value } = await ElMessageBox.prompt('给这台机器起个名', '改名', {
      inputValue: selected.value.name || '',
      confirmButtonText: '改',
      cancelButtonText: '算了',
    });
    await api.renameClient(selectedId.value, value);
    await auth.fetchClients();
    ElMessage.success('改好了。');
  } catch (_) {
    /* 取消 */
  }
}

async function unbind() {
  try {
    await ElMessageBox.confirm('解绑后你就看不到这台机器了。', '确定解绑？', {
      confirmButtonText: '解绑',
      cancelButtonText: '算了',
      type: 'warning',
    });
    await api.unbindClient(selectedId.value);
    selectedId.value = null;
    await auth.fetchClients();
    ElMessage.success('解开了。');
  } catch (_) {
    /* 取消 */
  }
}

function logout() {
  auth.logout();
  router.push('/');
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtTime(t) {
  return t ? String(t).replace('T', ' ').slice(0, 19) : '—';
}
</script>

<template>
  <div class="dash">
    <!-- 左侧：机器列表 -->
    <aside class="rail">
      <div class="rail-head">
        <p class="eyebrow">我的机器</p>
        <button class="btn small primary" @click="bindDialog.open = true">
          <iconify-icon icon="ph:plus"></iconify-icon>绑定
        </button>
      </div>

      <p class="rail-sum mono">{{ clients.length }} 台 · 在线 {{ auth.onlineCount }}</p>

      <div v-if="loading" class="rail-empty muted">正在拉列表…</div>
      <div v-else-if="!clients.length" class="rail-empty">
        <p class="muted">还没有机器。</p>
        <p class="muted">去一体机上打开客户端，抄下它的 ID，再点上面的「绑定」。</p>
      </div>

      <ul class="client-list">
        <li
          v-for="c in clients"
          :key="c.id"
          :class="['client', { active: c.id === selectedId }]"
          @click="selectClient(c)"
        >
          <span :class="['live', auth.presence[c.id] ? 'on' : '']"></span>
          <div class="client-main">
            <p class="cname">{{ c.name || '未命名一体机' }}</p>
            <p class="cmeta mono">{{ c.clientUid }}</p>
          </div>
          <span class="mono cseen">{{ c.lastSeen ? String(c.lastSeen).slice(11, 16) : '—' }}</span>
        </li>
      </ul>

      <div class="rail-foot">
        <p class="mono tiny">{{ SERVER_URL || '同源部署' }}</p>
        <p class="muted tiny">官方：{{ OFFICIAL_SERVER }}</p>
      </div>
    </aside>

    <!-- 右侧：工作区 -->
    <section class="work">
      <div v-if="!selected" class="empty">
        <iconify-icon icon="ph:desktop-tower"></iconify-icon>
        <h2>先选一台机器</h2>
        <p class="muted">左边点一下，或者先绑定新的。</p>
      </div>

      <template v-else>
        <header class="work-head">
          <div>
            <h1>{{ selected.name || '未命名一体机' }}</h1>
            <p class="mono muted">
              {{ selected.clientUid }}
              <span v-if="selected.os"> · {{ selected.os }}</span>
              <span v-if="selected.version"> · v{{ selected.version }}</span>
              <span v-if="selected.lastIp"> · {{ selected.lastIp }}</span>
            </p>
          </div>
          <div class="head-right">
            <span :class="['pill', selectedOnline ? 'on' : '']">
              <span class="dot"></span>{{ selectedOnline ? '在线' : '离线' }}
            </span>
            <button class="btn small" @click="rename"><iconify-icon icon="ph:pencil-simple"></iconify-icon>改名</button>
            <button class="btn small danger" @click="unbind"><iconify-icon icon="ph:link-break"></iconify-icon>解绑</button>
            <button class="btn small ghost" @click="logout"><iconify-icon icon="ph:sign-out"></iconify-icon>退出</button>
          </div>
        </header>

        <nav class="tabs">
          <button
            v-for="t in tabs"
            :key="t.key"
            :class="['tab', { active: tab === t.key }]"
            @click="switchTab(t.key)"
          >
            <iconify-icon :icon="t.icon"></iconify-icon>{{ t.label }}
          </button>
        </nav>

        <!-- 屏幕 -->
        <div v-show="tab === 'screen'" class="pane">
          <div class="pane-bar">
            <button class="btn small" :class="{ primary: screenOn }" @click="screenOn ? stopScreen() : startScreen()">
              <iconify-icon :icon="screenOn ? 'ph:pause' : 'ph:play'"></iconify-icon>
              {{ screenOn ? '停止' : '开始看' }}
            </button>
            <button class="btn small" :class="{ amber: controlMode }" :disabled="!selectedOnline" @click="controlMode = !controlMode">
              <iconify-icon icon="ph:cursor-click"></iconify-icon>{{ controlMode ? '退出控制' : '远程控制' }}
            </button>
            <button class="btn small" @click="screenshot"><iconify-icon icon="ph:camera"></iconify-icon>截图</button>
            <button class="btn small" @click="toggleFullscreen"><iconify-icon icon="ph:arrows-out"></iconify-icon>全屏</button>

            <label class="zoom">
              缩放
              <input v-model.number="scale" type="range" min="0.4" max="2" step="0.1" />
              <span class="mono">{{ scale.toFixed(1) }}x</span>
            </label>

            <span class="mono stat">{{ frameSize || '—' }} · {{ frameFps }} fps</span>
          </div>

          <div
            ref="stage"
            :class="['stage', { controlling: controlMode }]"
            tabindex="0"
            @mousemove="onMove"
            @mouseleave="onMoveFlush"
            @mousedown="onMouse('mousedown')"
            @mouseup="onMouse('mouseup')"
            @contextmenu.prevent
            @keydown="onKey"
          >
            <img v-if="frameSrc" :src="frameSrc" :style="{ transform: `scale(${scale})` }" alt="客户端屏幕" />
            <div v-else class="stage-empty">
              <iconify-icon icon="ph:monitor-play"></iconify-icon>
              <p>{{ selectedOnline ? '点「开始看」拉画面。' : '机器离线，等它上线。' }}</p>
              <p class="muted tiny">画面经服务端中继，局域网内会走 P2P 直连。</p>
            </div>
          </div>

          <p v-if="controlMode" class="ctrl-tip">
            <iconify-icon icon="ph:warning-circle"></iconify-icon>
            控制开着呢。你在这儿的点击和按键会直接作用到那台机器上。
          </p>
        </div>

        <!-- 音频 -->
        <div v-show="tab === 'audio'" class="pane">
          <div class="audio-now card">
            <p class="eyebrow">现在在放什么</p>
            <template v-if="audioLatest">
              <h2>{{ audioLatest.process_name || '未知进程' }}</h2>
              <p class="muted">{{ audioLatest.title || '（没有标题）' }}</p>
              <div class="volume">
                <div class="volume-bar"><span :style="{ width: (audioLatest.volume || 0) + '%' }"></span></div>
                <span class="mono">{{ audioLatest.volume || 0 }}%</span>
              </div>
              <p class="muted tiny">状态：{{ audioLatest.state }} · 更新于 {{ fmtTime(audioLatest.timestamp) }}</p>
            </template>
            <p v-else class="muted">没听到声音。也可能是客户端还没上报。</p>
          </div>

          <div class="card table-card">
            <div class="card-head">
              <h3>音频历史</h3>
              <button class="btn small ghost" @click="loadAudio"><iconify-icon icon="ph:arrows-clockwise"></iconify-icon>刷新</button>
            </div>
            <table>
              <thead><tr><th>时间</th><th>进程</th><th>标题</th><th>音量</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="a in audioLogs" :key="a.id">
                  <td class="mono">{{ fmtTime(a.timestamp) }}</td>
                  <td>{{ a.process_name || '—' }}</td>
                  <td>{{ a.title || '—' }}</td>
                  <td class="mono">{{ a.volume }}%</td>
                  <td>{{ a.state }}</td>
                </tr>
                <tr v-if="!audioLogs.length"><td colspan="5" class="muted">还没有记录。</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 文件记录 -->
        <div v-show="tab === 'files'" class="pane">
          <div class="pane-bar">
            <input v-model="fileQuery" placeholder="搜路径" @keydown.enter="searchFiles" />
            <select v-model="fileOperation" @change="searchFiles">
              <option value="">全部操作</option>
              <option value="created">新建</option>
              <option value="modified">修改</option>
              <option value="deleted">删除</option>
              <option value="moved">移动</option>
              <option value="renamed">重命名</option>
            </select>
            <button class="btn small" @click="searchFiles"><iconify-icon icon="ph:magnifying-glass"></iconify-icon>搜</button>
            <button class="btn small" @click="exportFiles"><iconify-icon icon="ph:download-simple"></iconify-icon>导出 CSV</button>
            <button class="btn small danger" @click="clearFiles"><iconify-icon icon="ph:trash"></iconify-icon>清空</button>
          </div>

          <div class="card table-card">
            <table>
              <thead><tr><th>时间</th><th>操作</th><th>文件</th><th>大小</th></tr></thead>
              <tbody>
                <tr v-for="l in fileLogs" :key="l.id">
                  <td class="mono">{{ fmtTime(l.timestamp) }}</td>
                  <td><span class="pill">{{ l.operation }}</span></td>
                  <td class="path">{{ l.file_path }}</td>
                  <td class="mono">{{ fmtSize(l.file_size) }}</td>
                </tr>
                <tr v-if="!fileLogs.length"><td colspan="4" class="muted">没有记录。它可能很乖，也可能监控目录没配。</td></tr>
              </tbody>
            </table>
            <div class="pager">
              <button class="btn small ghost" :disabled="filePage <= 1" @click="changePage(-1)">上一页</button>
              <span class="mono muted">第 {{ filePage }} 页 · 共 {{ fileTotal }} 条</span>
              <button class="btn small ghost" :disabled="filePage * fileLimit >= fileTotal" @click="changePage(1)">下一页</button>
            </div>
          </div>
        </div>

        <!-- 命令 -->
        <div v-show="tab === 'command'" class="pane">
          <div class="cmd-grid">
            <button
              v-for="c in commands"
              :key="c.key"
              :class="['cmd', { danger: c.danger }]"
              :disabled="!selectedOnline"
              @click="runCommand(c)"
            >
              <iconify-icon :icon="c.icon"></iconify-icon>
              <span>{{ c.label }}</span>
            </button>
          </div>

          <div class="card">
            <h3>执行回执</h3>
            <ul class="log">
              <li v-for="(l, i) in commandLog" :key="i">
                <span :class="['pill', l.ok ? 'on' : 'bad']">{{ l.ok ? '好' : '挂' }}</span>
                <span class="mono">{{ l.command }}</span>
                <span class="muted">{{ l.output || '' }}</span>
                <span class="mono muted right">{{ fmtTime(l.at) }}</span>
              </li>
              <li v-if="!commandLog.length" class="muted">还没发过命令。</li>
            </ul>
          </div>
        </div>

        <!-- 设置 -->
        <div v-show="tab === 'settings'" class="pane">
          <div class="card">
            <h3>记录保留策略</h3>
            <p class="muted">改完立刻同步到那台机器，它会自己删旧的。</p>
            <div class="two">
              <div class="field">
                <label>最多留多少条</label>
                <input v-model.number="settings.maxLogCount" type="number" min="100" step="100" />
              </div>
              <div class="field">
                <label>最多占多少字节</label>
                <input v-model.number="settings.maxLogSize" type="number" min="1048576" step="1048576" />
                <p class="muted tiny">当前约 {{ fmtSize(settings.maxLogSize) }}</p>
              </div>
            </div>
            <button class="btn primary" @click="saveSettings"><iconify-icon icon="ph:floppy-disk"></iconify-icon>保存并同步</button>
          </div>

          <div class="card">
            <h3>服务器</h3>
            <div class="kv">
              <div><span>官方服务器</span><span class="mono">{{ OFFICIAL_SERVER }}</span></div>
              <div><span>当前教师端地址</span><span class="mono">{{ SERVER_URL || '同源（开发模式）' }}</span></div>
              <div><span>内置状态</span><span>官方服务器不可删除</span></div>
            </div>
            <p class="muted tiny">自定义服务器在客户端设置里加，教师端跟着客户端走。</p>
          </div>

          <div class="card">
            <h3>危险操作</h3>
            <div class="row">
              <button class="btn small danger" @click="unbind"><iconify-icon icon="ph:link-break"></iconify-icon>解绑这台机器</button>
              <button class="btn small danger" @click="logout"><iconify-icon icon="ph:sign-out"></iconify-icon>退出登录</button>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- 绑定弹窗 -->
    <div v-if="bindDialog.open" class="modal-layer" @click.self="bindDialog.open = false">
      <div class="modal glass">
        <h3>绑定一台一体机</h3>
        <p class="muted">机器上打开客户端，托盘「关于」里能看到它的 ID。</p>
        <div class="field">
          <label>客户端 ID</label>
          <input v-model.trim="bindDialog.uid" placeholder="例如 3F-A07-9C21B4" class="mono" />
        </div>
        <div class="field">
          <label>给它起个名（可留空）</label>
          <input v-model.trim="bindDialog.name" placeholder="高一(3)班一体机" />
        </div>
        <div class="modal-foot">
          <button class="btn ghost" @click="bindDialog.open = false">算了</button>
          <button class="btn primary" :disabled="bindDialog.busy" @click="bind">绑上</button>
        </div>
      </div>
    </div>

    <!-- 命令参数弹窗 -->
    <div v-if="textDialog.open" class="modal-layer" @click.self="textDialog.open = false">
      <div class="modal glass">
        <h3>{{ textDialog.title }}</h3>
        <div class="field">
          <input v-model="textDialog.value" :placeholder="textDialog.placeholder" @keydown.enter="confirmDialog" />
        </div>
        <div class="modal-foot">
          <button class="btn ghost" @click="textDialog.open = false">算了</button>
          <button class="btn primary" @click="confirmDialog">发过去</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dash {
  display: grid;
  grid-template-columns: 268px 1fr;
  min-height: calc(100vh - 62px);
}

/* --------------------------------- 侧栏 --------------------------------- */
.rail {
  border-right: 1px solid var(--line);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: color-mix(in srgb, var(--ink) 60%, transparent);
}
.rail-head { display: flex; align-items: center; justify-content: space-between; }
.rail-head .eyebrow { margin: 0; }
.rail-sum { font-size: 12px; color: var(--sage); margin: 0; }
.rail-empty { font-size: 13px; line-height: 1.7; }
.client-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; overflow-y: auto; }
.client {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, transform 0.18s;
}
.client:hover { background: rgba(243, 239, 227, 0.06); }
.client.active {
  background: rgba(63, 107, 82, 0.3);
  border-color: rgba(143, 168, 142, 0.42);
  transform: translateX(3px);
}
.live { width: 8px; height: 8px; border-radius: 50%; background: rgba(243, 239, 227, 0.25); flex: 0 0 8px; }
.live.on { background: #7fc59a; box-shadow: 0 0 0 4px rgba(127, 197, 154, 0.18); }
.client-main { min-width: 0; flex: 1; }
.cname { margin: 0; font-size: 13.8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmeta { margin: 2px 0 0; font-size: 11px; color: var(--sage); }
.cseen { font-size: 11px; color: var(--text-dim); }
.rail-foot { margin-top: auto; border-top: 1px dashed var(--line); padding-top: 10px; }
.tiny { font-size: 11px; margin: 2px 0; word-break: break-all; }

/* --------------------------------- 工作区 --------------------------------- */
.work { padding: 20px 26px 40px; min-width: 0; }
.empty { display: grid; place-items: center; gap: 8px; padding: 120px 20px; text-align: center; }
.empty iconify-icon { font-size: 42px; color: var(--sage); }

.work-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-bottom: 16px; }
.work-head h1 { font-size: 22px; margin-bottom: 6px; }
.head-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 18px; }
.tab {
  display: inline-flex; align-items: center; gap: 7px;
  background: none; border: 0; border-bottom: 2px solid transparent;
  color: var(--text-dim); padding: 10px 14px; font-size: 14px; cursor: pointer;
  transition: color 0.18s, border-color 0.18s;
}
.tab:hover { color: var(--text); }
.tab.active { color: var(--text); border-color: var(--amber); font-weight: 600; }

.pane { display: grid; gap: 16px; }
.pane-bar {
  display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--surface);
}
.pane-bar input[type='text'], .pane-bar input:not([type]) {
  border: 1px solid var(--line); background: rgba(12, 17, 12, 0.5);
  color: var(--text); border-radius: 9px; padding: 8px 11px; font-size: 13.5px; min-width: 180px;
}
.pane-bar select {
  border: 1px solid var(--line); background: rgba(12, 17, 12, 0.5);
  color: var(--text); border-radius: 9px; padding: 8px 10px; font-size: 13.5px;
}
.zoom { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-dim); margin-left: auto; }
.zoom input { width: 120px; accent-color: var(--moss-2); }
.stat { font-size: 12px; color: var(--sage); }

/* --------------------------------- 舞台 --------------------------------- */
.stage {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 15px;
  background:
    radial-gradient(600px 300px at 50% 0%, rgba(63, 107, 82, 0.24), transparent 70%),
    rgba(8, 12, 8, 0.7);
  min-height: 340px;
  display: grid;
  place-items: center;
  overflow: hidden;
  outline: none;
}
.stage.controlling { border-color: rgba(201, 123, 60, 0.65); cursor: crosshair; }
.stage img { max-width: 100%; max-height: 70vh; transition: transform 0.2s ease; display: block; }
.stage-empty { display: grid; place-items: center; gap: 6px; color: var(--sage); }
.stage-empty iconify-icon { font-size: 36px; }
.ctrl-tip {
  display: flex; align-items: center; gap: 9px;
  margin: 0; padding: 11px 14px;
  border: 1px dashed rgba(201, 123, 60, 0.55);
  border-radius: 12px;
  color: var(--amber); font-size: 13.4px;
}

/* --------------------------------- 音频 --------------------------------- */
.audio-now h2 { font-size: 20px; margin-bottom: 6px; }
.volume { display: flex; align-items: center; gap: 12px; margin: 14px 0 8px; }
.volume-bar { flex: 1; height: 7px; border-radius: 99px; background: rgba(243, 239, 227, 0.12); overflow: hidden; }
.volume-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--moss-2), var(--amber)); transition: width 0.3s ease; }

/* --------------------------------- 表格 --------------------------------- */
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.table-card { padding: 16px 18px 14px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.4px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
th { color: var(--sage); font-weight: 500; font-size: 12.4px; }
.path { max-width: 460px; word-break: break-all; white-space: normal; color: var(--text-dim); }
.pager { display: flex; align-items: center; gap: 12px; margin-top: 14px; font-size: 12.5px; }

/* --------------------------------- 命令 --------------------------------- */
.cmd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 11px; }
.cmd {
  display: grid; place-items: center; gap: 8px;
  padding: 18px 10px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--surface);
  color: var(--text);
  font-size: 13.6px;
  cursor: pointer;
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.18s;
}
.cmd iconify-icon { font-size: 21px; color: var(--sage); }
.cmd:hover:not(:disabled) { transform: translateY(-3px); border-color: rgba(143, 168, 142, 0.5); }
.cmd:disabled { opacity: 0.4; cursor: not-allowed; }
.cmd.danger iconify-icon { color: #d98a7c; }
.log { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.log li { display: flex; align-items: center; gap: 10px; font-size: 13.2px; }
.log .right { margin-left: auto; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.kv { display: grid; gap: 10px; margin-bottom: 12px; }
.kv div { display: flex; justify-content: space-between; gap: 14px; font-size: 13.4px; border-bottom: 1px dashed var(--line); padding-bottom: 8px; }
.kv span:first-child { color: var(--sage); }
.row { display: flex; gap: 10px; flex-wrap: wrap; }

/* --------------------------------- 弹窗 --------------------------------- */
.modal-layer {
  position: fixed; inset: 0; z-index: 80;
  display: grid; place-items: center;
  background: color-mix(in srgb, var(--ink) 70%, transparent);
  backdrop-filter: blur(8px);
}
.modal { width: min(480px, 92vw); padding: 26px; }
.modal h3 { font-size: 18px; margin-bottom: 10px; }
.modal-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }

@media (max-width: 1000px) {
  .dash { grid-template-columns: 1fr; }
  .rail { border-right: 0; border-bottom: 1px solid var(--line); }
  .client-list { grid-auto-flow: column; overflow-x: auto; }
  .two { grid-template-columns: 1fr; }
}
</style>
