<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { toast } from '@/utils/toast';
import { useAuthStore } from '@/stores/auth';
import { api, OFFICIAL_SERVER, SERVER_URL } from '@/api';
import StarBackdrop from '@/components/StarBackdrop.vue';

const router = useRouter();
const auth = useAuthStore();

/* --------------------------------- 状态 --------------------------------- */

const tab = ref('screen');
const selectedId = ref(null);
const loading = ref(true);

/**
 * 左右两栏收起来 / 放出来。
 * 都是「缩进屏幕外」：列宽收成 0、面板淡出，边上留个小把手拉回来。
 * 状态存本地，刷新后保持。
 */
const RAIL_KEY = 'mythclass.dash.rail';
const EVENTS_KEY = 'mythclass.dash.events';
const railOpen = ref(localStorage.getItem(RAIL_KEY) !== '0');
const eventsOpen = ref(localStorage.getItem(EVENTS_KEY) !== '0');

function toggleRail(open) {
  railOpen.value = open;
  try {
    localStorage.setItem(RAIL_KEY, open ? '1' : '0');
  } catch (_) {
    /* 存不了就算了 */
  }
}

function toggleEvents(open) {
  eventsOpen.value = open;
  try {
    localStorage.setItem(EVENTS_KEY, open ? '1' : '0');
  } catch (_) {
    /* 存不了就算了 */
  }
}

const frameSrc = ref('');
const frameFps = ref(0);
const frameSize = ref('');
const scale = ref(1);
const controlMode = ref(false);
const screenOn = ref(false);

// 画面通道：idle=没在看 / relay=服务端转发 / p2p=两端直连
const transport = ref('idle');
const rtt = ref(null); // 到服务端的往返延迟，毫秒

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

/* --------------------- 极域那套：缩略图墙 + 右侧事件栏 --------------------- */

const thumbs = ref({}); // clientId -> 小图 dataURL
const thumbAt = ref({}); // clientId -> 上次拿到小图的时间
const evTab = ref('event');
const msgLog = ref([]); // 上下线之类的消息
let thumbTimer = null;

const bindDialog = ref({ open: false, uid: '', name: '', busy: false });
const textDialog = ref({ open: false, kind: 'message', title: '', value: '', placeholder: '' });
const stage = ref(null); // 屏幕舞台 DOM

let lastFrameAt = 0;
let statsTimer = null;
let lastMoveSent = 0;
let movePending = null;

/* --------------------------------- 计算 --------------------------------- */

const clients = computed(() => auth.clients);
const selected = computed(() => clients.value.find((c) => c.id === selectedId.value) || null);
const selectedOnline = computed(() => (selected.value ? !!auth.presence[selected.value.id] : false));

/**
 * 选中一台同一局域网的一体机时，自动提示一次「建议用它自己跑的那个网页」。
 * 每台机器每次会话只弹一次，老师选了「先这样」就不再烦他。
 */
function suggestDirect(client) {
  if (!client) return;
  // 判断依据：要么服务端说同一局域网，要么 P2P 已经真的直连上了
  // （后者不需要服务端更新，而且更准）
  const sameLan = client.sameNetwork === true || !!p2pPeerIp.value;
  if (!sameLan) return;
  if (!lanPageUrl(client)) return; // 连地址都拿不到就别打扰人家
  if (directAsked.has(client.id)) return;
  directAsked.add(client.id);
  askDirect(client);
}

watch(selectedId, (id) => {
  const picked = clients.value.find((c) => c.id === id);
  if (picked) setTimeout(() => suggestDirect(picked), 350);
});

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
  { key: 'net_ban', label: '禁止上网', icon: 'ph:prohibit', args: ['minutes'] },
  { key: 'net_ban_lift', label: '放开上网', icon: 'ph:shield-check', args: [] },
];

/** 上下线记进「消息」：极域右下角那个列表也是干这个的 */
watch(
  () => ({ ...auth.presence }),
  (now, before) => {
    for (const c of clients.value) {
      const was = before ? before[c.id] : undefined;
      if (was === now[c.id]) continue;
      const label = c.name || c.clientUid;
      if (now[c.id]) pushMessage(`${label} 上线了`);
      else if (was !== undefined) pushMessage(`${label} 断开了`);
    }
  },
  { deep: true }
);

/** 顶部那一横条：常用的几个动作，跟极域的工具栏一个意思 */
const quickTools = computed(() => [
  {
    key: 'screen',
    label: screenOn.value ? '停止画面' : '屏幕广播',
    icon: screenOn.value ? 'ph:pause' : 'ph:monitor-play',
    run: () => (screenOn.value ? stopScreen() : startScreen()),
  },
  {
    key: 'control',
    label: controlMode.value ? '退出控制' : '远程控制',
    icon: 'ph:cursor-click',
    run: () => (controlMode.value = !controlMode.value),
  },
  { key: 'lock', label: '锁屏', icon: 'ph:lock', run: () => runCommand(commands[0]) },
  { key: 'unlock', label: '解锁', icon: 'ph:lock-open', run: () => runCommand(commands[1]) },
  { key: 'message', label: '弹消息', icon: 'ph:chat-centered-text', run: () => runCommand(commands[5]) },
  { key: 'broadcast', label: '演示广播', icon: 'ph:broadcast', run: () => runCommand(commands[9]) },
  { key: 'ban', label: '禁止上网', icon: 'ph:prohibit', run: () => runCommand(commands[10]) },
  { key: 'unban', label: '放开上网', icon: 'ph:shield-check', run: () => runCommand(commands[11]) },
  { key: 'shot', label: '截图', icon: 'ph:camera', run: () => screenshot() },
  { key: 'reboot', label: '重启', icon: 'ph:arrows-clockwise', run: () => runCommand(commands[3]) },
  { key: 'shutdown', label: '关机', icon: 'ph:power', run: () => runCommand(commands[2]) },
]);

/** 右侧那一栏：事件看命令回执，消息看上下线 */
const evList = computed(() => {
  if (evTab.value === 'message') return msgLog.value;
  return commandLog.value.slice(0, 60).map((r) => ({
    time: r.time || '',
    text: `${r.command || '命令'} · ${r.ok ? '成功' : '失败'}`,
  }));
});

/* -------------------------------- 启动/收尾 -------------------------------- */

onMounted(async () => {
  try {
    if (!auth.user) await auth.fetchMe();
  } catch (err) {
    toast.error(err.message);
  }

  try {
    await auth.fetchClients();
    if (clients.value.length) selectClient(clients.value[0]);
  } catch (err) {
    toast.error(err.message);
  } finally {
    loading.value = false;
  }

  // 机器墙每隔一会儿补一遍小图
  startThumbPoll();


  auth.openSocket({
    onFrame: (payload) => {
      // 缩略图只进机器墙，别糊到主画面上
      if (payload && payload.thumb) {
        thumbs.value[payload.clientId] = payload.data;
        thumbAt.value[payload.clientId] = Date.now();
        return;
      }
      applyFrame(payload, false);
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

      // 通知的回答：客户端会补一条 output 以「回答：」开头的 command_result
      if (
        payload.command === 'message' &&
        typeof payload.output === 'string' &&
        payload.output.startsWith('回答：')
      ) {
        const who = selected.value ? selected.value.name || selected.value.clientUid : '这台机器';
        pushMessage(`${who} ${payload.output}`);
        toast.info(`${who} ${payload.output}`);
        return;
      }

      // 成功的命令只记进右边的事件栏，不再弹 —— 一次批量下发会糊满屏
      if (!payload.ok) {
        toast.warning(`${payload.command || '命令'} 失败了`);
      }
    },
  });

  // P2P 的 answer 会从这条连接回来
  if (auth.socket) auth.socket.on('answer', onP2PAnswer);

  // 断线重连后：房间由 store 补 watch，画面得我们自己再要一次
  if (auth.socket) {
    auth.socket.on('connect', () => {
      if (screenOn.value && selectedId.value) startScreen(true);
    });
  }
});

onBeforeUnmount(() => {
  stopStatsProbe();
  closeP2P();
  stopThumbPoll();
  if (selectedId.value && screenOn.value) auth.sendCommand(selectedId.value, 'screen_stop');
  auth.unwatchClient(selectedId.value);
});

/* -------------------------------- 客户端操作 -------------------------------- */

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function pushMessage(text) {
  msgLog.value.unshift({ time: stamp(), text });
  if (msgLog.value.length > 80) msgLog.value.pop();
}

/** 问一台机器要一张小图。不用回执，丢了就丢了 */
function askThumb(c) {
  const socket = auth.socket;
  if (!socket || !socket.connected) return;
  socket.emit('command', {
    clientId: c.id,
    command: 'request_frame',
    args: { width: 320, quality: 40 },
    requestId: `thumb-${c.id}-${Date.now()}`,
  });
}

/** 隔一会儿给机器墙补一遍小图。只在页面可见时问 */
function pollThumbs() {
  if (document.hidden) return;
  for (const c of clients.value) {
    if (!auth.presence[c.id]) continue; // 离线的问也白问
    auth.watchClient(c.id); // 订阅了才收得到它发的帧
    askThumb(c);
  }
}

function startThumbPoll() {
  stopThumbPoll();
  setTimeout(pollThumbs, 1200);
  thumbTimer = setInterval(pollThumbs, 10000);
}

function stopThumbPoll() {
  if (thumbTimer) {
    clearInterval(thumbTimer);
    thumbTimer = null;
  }
}

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

// ------------------------------ P2P 直连 ------------------------------
// 只用一个数据通道传 JPEG 帧，不搞视频轨道：省掉编解码器，渲染代码也不用改。
// 用非 trickle ICE（等候选收齐再发完整 SDP），省掉单独的 ice 交换。
let p2p = null;

/** 手动试直连的时候按钮转圈 */
const p2pTrying = ref(false);

/** 轮询等一个条件成立（试直连有没有成） */
function waitFor(check, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

/**
 * 手动再试一次 P2P 直连。
 * 自动那次是在「开始看」的时候试的，没成之后不会自己重试 ——
 * 网络环境变了（比如老师换到同一个网段）就得有个手动重试的口子。
 */
async function manualP2P() {
  if (!selectedId.value) {
    toast.warning('先选一台机器');
    return;
  }
  if (typeof RTCPeerConnection === 'undefined') {
    toast.warning('这个浏览器不支持直连');
    return;
  }
  if (p2pTrying.value) return;

  p2pTrying.value = true;
  try {
    closeP2P();
    transport.value = 'idle';
    toast.info('正在试直连…');
    startP2P(selectedId.value);
    const ok = await waitFor(() => transport.value === 'p2p', 9000);
    if (ok) {
      toast.success('直连成功，画面不再经过服务器');
    } else {
      toast.warning('直连没成，继续走服务器中继');
    }
  } finally {
    p2pTrying.value = false;
  }
}

function closeP2P() {
  if (!p2p) return;
  try {
    if (p2p.channel) p2p.channel.close();
    if (p2p.pc) p2p.pc.close();
  } catch (_) {
    /* 关不上就算了 */
  }
  p2p = null;
}

async function startP2P(clientId) {
  closeP2P();

  const socket = auth.socket;
  if (!socket || !socket.connected || typeof RTCPeerConnection === 'undefined') {
    return; // 环境不支持就老老实实走中继
  }

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
  const channel = pc.createDataChannel('mythclass', { ordered: false, maxRetransmits: 0 });
  const session = { pc, channel, clientId, sent: false, timer: null };
  p2p = session;

  channel.onopen = () => {
    if (p2p === session) {
      transport.value = 'p2p';
      // P2P 直连成功 → 从远端描述里把对方内网 IP 抠出来，
      // 后面「建议用它的网页」就靠这个（原来只依赖服务端字段）
      try {
        p2pPeerIp.value =
          pickPrivateIp(session.pc && session.pc.remoteDescription && session.pc.remoteDescription.sdp) ||
          pickPrivateIp(session.remoteSdp || '');
        if (p2pPeerIp.value) {
          console.log('[Mythclass] P2P 直连，对方局域网 IP', p2pPeerIp.value);
          setTimeout(() => suggestDirect(selected.value), 500);
        }
      } catch (err) {
        console.warn('抠对方 IP 失败', err);
      }
    }
  };
  channel.onclose = () => {
    if (p2p === session && transport.value === 'p2p') transport.value = 'relay';
  };
  channel.onmessage = (event) => {
    if (p2p !== session) return;
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch (_) {
      return;
    }
    applyFrame(payload, true);
  };

  const sendOffer = () => {
    if (session.sent || p2p !== session || !pc.localDescription) return;
    session.sent = true;
    socket.emit('offer', {
      clientId,
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
    });
  };
  pc.onicegatheringstatechange = () => {
    if (pc.iceGatheringState === 'complete') sendOffer();
  };

  try {
    await pc.setLocalDescription(await pc.createOffer());
  } catch (_) {
    closeP2P();
    return;
  }
  // 候选收不齐也得发出去，别一直干等
  session.timer = setTimeout(sendOffer, 2500);
}

function onP2PAnswer(payload) {
  if (!p2p || !payload || !payload.sdp) return;
  if (payload.clientId && payload.clientId !== p2p.clientId) return;
  p2p.pc.setRemoteDescription(payload.sdp).catch(() => closeP2P());
}

/** 一帧画面。fromP2P 表示它是从直连通道来的 */
function applyFrame(payload, fromP2P) {
  if (!payload || !payload.data) return;
  if (!fromP2P && payload.clientId !== selectedId.value) return;

  transport.value = fromP2P ? 'p2p' : 'relay';
  frameSrc.value = payload.data;
  if (payload.width) frameSize.value = `${payload.width}×${payload.height}`;

  const now = performance.now();
  if (lastFrameAt) {
    const gap = now - lastFrameAt;
    if (gap > 0) frameFps.value = Math.round(Math.min(1000 / gap, 60));
  }
  lastFrameAt = now;
}

/** 一体机本地网页的端口（客户端默认值，改客户端配置的话这里也要改） */
const LAN_WEB_PORT = 26925;

/** 这台机器本地网页的地址，没有内网 IP 就返回空 */
function lanPageUrl(client, withKey = true) {
  const ips = (client && client.localIps) || [];
  const ip = ips.find((x) => /^(10\.|192\.168\.|172\.)/.test(x)) || p2pPeerIp.value;
  if (!ip) return '';
  // 带上密钥：老师点一下就直接进控制界面，不用手输
  const key = (client && client.lanKey) || '';
  const query = withKey && key ? `?key=${encodeURIComponent(key)}` : '';
  return `http://${ip}:${LAN_WEB_PORT}/${query}`;
}

/**
 * 从 P2P 连接里抠出来的「对方局域网 IP」。
 *
 * 为什么需要它：服务端给的 sameNetwork / localIps 只有更新过服务端才有。
 * 而 P2P 一旦真的直连成功，远端 SDP 里必然带着对方的内网候选地址 ——
 * 这本身就是「同一个局域网」最硬的证据，比出口 IP 那套还准。
 */
const p2pPeerIp = ref('');

/** 从 SDP 里挑出第一个内网 IPv4（公网/srflx/relay 的一律不算） */
function pickPrivateIp(sdp) {
  if (!sdp) return '';
  const found = [];
  const re = /a=candidate:\S+ \d+ (?:udp|tcp) \d+ ([0-9.]+)/gi;
  let m;
  while ((m = re.exec(sdp)) !== null) found.push(m[1]);
  const extra = /(?:^|[^0-9])((?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.[0-9.]+)/g;
  while ((m = extra.exec(sdp)) !== null) found.push(m[1]);
  return found.find((ip) => /^(10\.|192\.168\.|172\.)/.test(ip)) || '';
}

/** 这次会话里已经问过「要不要直连」的机器，别反复打扰 */
const directAsked = new Set();

/**
 * 通知编辑框。
 * 选项按位置决定样子（主人定的）：第一个高亮、第二个普通、第三个是输入框；
 * 每个都能单独勾上或关掉。
 */
const notice = ref({
  open: false,
  topmost: true,
  fullscreen: false,
  title: '',
  body: '',
  opts: [
    { on: true, label: '知道了' },
    { on: false, label: '' },
    { on: false, label: '' },
  ],
});

function openNotice() {
  if (!selectedId.value) return toast.warning('先选一台机器');
  notice.value = {
    open: true,
    topmost: true,
    fullscreen: false,
    title: '',
    body: '',
    opts: [
      { on: true, label: '知道了' },
      { on: false, label: '' },
      { on: false, label: '' },
    ],
  };
}

async function sendNotice() {
  const n = notice.value;
  if (!n.body.trim() && !n.title.trim()) return toast.warning('标题和内容至少写一个');
  const options = n.opts
    .map((o, i) => (o.on ? { on: true, label: o.label.trim(), slot: i } : null))
    .filter(Boolean);
  const ack = await auth.sendCommand(selectedId.value, 'message', {
    title: n.title.trim() || '老师有话要说',
    body: n.body.trim() || n.title.trim(),
    topmost: n.topmost,
    fullscreen: n.fullscreen,
    options,
  });
  notice.value.open = false;
  if (ack && ack.ok) toast.success('通知发出去了，等他回答');
  else toast.warning('没发成功，机器可能离线');
}


/** 探一下那个网页通不通（超时 1.5 秒，探不通不算错，只是换种提示） */
function probeLanPage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.onload = img.onerror = null;
      resolve(false);
    }, 1500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(true); // 有响应（哪怕是 401/404）就说明端口是通的
    };
    img.src = url + 'favicon.ico?_=' + Date.now();
  });
}

/** 一键打开局域网控制台：探测通了就直接开，不再多问一句 */
async function openLanConsole(client) {
  const target = client || selected.value;
  const url = lanPageUrl(target);
  if (!url) {
    toast.warning('这台机器还没上报内网地址');
    return false;
  }
  const alive = await probeLanPage(url);
  if (!alive) {
    toast.error('本地网页打不开，先在那台机器上看看客户端在不在跑');
    return false;
  }
  window.open(url, '_blank', 'noopener');
  toast.success('已打开局域网控制台（密钥已经带上了）');
  return true;
}

/** 问一下要不要切到直连（就是打开一体机自己那个页面） */
async function askDirect(client) {
  const url = lanPageUrl(client);
  if (!url) {
    toast.warning('这台机器还没上报内网地址，先走服务器吧');
    return false;
  }

  // 先探一下。探不通就别把人送到 ERR_CONNECTION_REFUSED
  const alive = await probeLanPage(url);
  if (!alive) {
    try {
      await ElMessageBox.alert(
        `「${client.name || '这台机器'}」的本地网页打不开（${url}）。\n\n` +
          '多半是这两种情况：\n' +
          '· 客户端版本旧了（本地网页要 v2.0.6 以后才有）\n' +
          '· 客户端没在跑 —— 在那台机器上跑 MythclassClient.exe --status，' +
          '看「本地网页」那行是不是「开着」\n\n' +
          '现在照样能看画面，走的是服务器中继。',
        '这台机器没开本地网页',
        { confirmButtonText: '知道了', type: 'warning' }
      );
    } catch (_) {
      /* 关掉就算了 */
    }
    return false;
  }
  try {
    await ElMessageBox.confirm(
      `「${client.name || '这台机器'}」和你在同一个局域网。\n\n` +
        '建议用它自己跑的那个网页看画面：画面直接来自这台机器，' +
        '不经过服务器，也不占它的带宽。\n' +
        `地址是 ${url}`,
      '建议用一体机自己跑的那个网页',
      { confirmButtonText: '打开它那个网页', cancelButtonText: '先这样', type: 'info' }
    );
  } catch (_) {
    return false; // 老师选了「继续走服务器」
  }
  return openLanConsole(client);
}

/** 当前这台机器和我是不是同一个局域网（服务端按出口 IP 判的） */
const sameLan = computed(() => {
  const c = selected.value;
  if (!c) return false;
  return c.sameNetwork === true && selectedOnline.value;
});

const sameLanHint = computed(() => {
  const ips = (selected.value && selected.value.localIps) || [];
  const mine = ips.length ? `它的内网地址：${ips.join('、')}` : '';
  return `这台机器和我在同一个局域网${mine ? '。' + mine : ''}。画面会优先两端直连，不经过服务端。`;
});

const transportLabel = computed(() => {
  if (transport.value === 'relay') return '服务端中继';
  if (transport.value === 'p2p') return 'P2P 直连';
  return '未在传输';
});

const transportHint = computed(() =>
  transport.value === 'p2p'
    ? '画面由客户端直连过来，不经服务端，不占它的带宽'
    : '画面经服务端转发（中继）。每次「开始看」都会先试 P2P 直连，成了这里会变成「P2P 直连」。'
);

/** 量一次到服务端的往返延迟 */
function measureLatency() {
  const socket = auth.socket;
  if (!socket || !socket.connected) {
    rtt.value = null;
    return;
  }
  const started = performance.now();
  let done = false;
  socket.emit('probe', {}, () => {
    done = true;
    rtt.value = Math.round(performance.now() - started);
  });
  // 服务端没回执就当测不到，别一直显示旧值
  setTimeout(() => {
    if (!done) rtt.value = null;
  }, 4000);
}

/** 看画面时每 5 秒量一次延迟，顺便盯一下画面是不是断了 */
function startStatsProbe() {
  stopStatsProbe();
  measureLatency();
  statsTimer = setInterval(() => {
    measureLatency();
    if (screenOn.value && lastFrameAt && performance.now() - lastFrameAt > 8000) {
      transport.value = 'idle';   // 八秒没帧了，别硬撑着显示「中继中」
      frameFps.value = 0;
    }
  }, 5000);
}

function stopStatsProbe() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
  rtt.value = null;
  frameFps.value = 0;
}

async function startScreen(force = false) {
  if (!selectedId.value) return;
  // force：断线重连后即使 UI 认为已经在看，也要重新要一次画面
  if (screenOn.value && !force) return;
  const ack = await auth.sendCommand(selectedId.value, 'screen_start', { fps: 12, quality: 60 });
  if (ack && ack.ok) {
    screenOn.value = true;
    transport.value = 'idle';
    startStatsProbe();
    startP2P(selectedId.value); // 直连能成就不用占服务端带宽
    // 兜一次：万一是直接点「开始看」进来的，也能收到那个建议
    setTimeout(() => suggestDirect(selected.value), 800);
  } else {
    toast.warning('没连上，可能机器离线。');
  }
}

async function stopScreen() {
  if (selectedId.value) {
    const ack = await auth.sendCommand(selectedId.value, 'screen_stop');
    if (!ack || !ack.ok) {
      toast.warning('停止命令没发出去（连接断了？），那台机器可能还在推流。');
    }
  }
  screenOn.value = false;
  frameSrc.value = '';
  stopStatsProbe();
  closeP2P();
  transport.value = 'idle';
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
  if (!frameSrc.value) return toast.warning('还没有画面。');
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
    toast.error(err.message);
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
    toast.success(`清掉了 ${data.removed} 条`);
    filePage.value = 1;
    loadFiles();
  } catch (_) {
    /* 用户取消 */
  }
}

function exportFiles() {
  if (!fileLogs.value.length) return toast.warning('没东西可导。');
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
    toast.error(err.message);
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
    toast.success('两边都改了。');
  } catch (err) {
    toast.error(err.message);
  }
}

/* -------------------------------- 命令面板 -------------------------------- */

async function runCommand(cmd) {
  if (!selectedId.value) return;
  if (!selectedOnline.value) return toast.warning('这台机器离线呢。');

  if (cmd.key === 'screen_start') return startScreen();

  // 弹消息：开那个能自定义标题/内容/选项的对话框
  if (cmd.key === 'message') return openNotice();

  if (cmd.key === 'lock' || cmd.key === 'unlock') {
    return sendPlain(cmd.key);
  }
  if (cmd.key === 'net_ban_lift') {
    try {
      await ElMessageBox.confirm('确认放开这台机器的上网？', '确认一下', {
        confirmButtonText: '放开',
        cancelButtonText: '算了',
        type: 'warning',
      });
    } catch (_) {
      return;
    }
    return sendPlain('net_ban', { enable: false });
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
      minutes: '断网多少分钟后自动放开，默认 60。填 0 表示不自动放开（要自己来解）',
    }[needs] || '',
  };
}

function sendPlain(command, args = {}) {
  auth.sendCommand(selectedId.value, command, args);
}

async function confirmDialog() {
  const d = textDialog.value;
  const value = d.value.trim();
  if (!value) return toast.warning('先填点东西。');

  const map = {
    message: { command: 'message', args: { text: value } },
    open_url: { command: 'open_url', args: { url: value } },
    open_app: { command: 'open_app', args: { path: value } },
    file_distribute: { command: 'file_distribute', args: { url: value } },
    screen_broadcast: { command: 'screen_broadcast', args: { url: value } },
    net_ban: { command: 'net_ban', args: { enable: true, minutes: value } },
  };
  const payload = map[d.kind];
  d.open = false;
  const ack = await auth.sendCommand(selectedId.value, payload.command, payload.args);
  if (!ack || !ack.ok) toast.warning('没送出去，机器可能刚好掉线。');
}

/* -------------------------------- 绑定与设置 -------------------------------- */

async function bind() {
  if (!bindDialog.value.uid.trim()) return toast.warning('机器 ID 得填。');
  bindDialog.value.busy = true;
  try {
    await api.bindClient({ clientUid: bindDialog.value.uid.trim(), name: bindDialog.value.name.trim() });
    toast.success('绑上了。');
    bindDialog.value = { open: false, uid: '', name: '', busy: false };
    await auth.fetchClients();
    if (clients.value.length) selectClient(clients.value[0]);
  } catch (err) {
    toast.error(err.message);
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
    toast.success('改好了。');
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
    toast.success('解开了。');
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
  <div class="dash" :class="{ 'rail-off': !railOpen, 'events-off': !eventsOpen }">
    <!-- 背后的星光，和登录过场同一片 -->
    <StarBackdrop />

    <!-- 两边收起来之后，留在屏幕边上的小把手 —— 不点它就回不来了 -->
    <button
      class="edge-toggle left"
      :class="{ off: !railOpen }"
      :title="railOpen ? '收起「我的机器」' : '展开「我的机器」'"
      @click="toggleRail(!railOpen)"
    >
      <iconify-icon :icon="railOpen ? 'ph:caret-left' : 'ph:caret-right'"></iconify-icon>
    </button>
    <!-- 通知编辑框 -->
    <div v-if="notice.open" class="notice-mask" @click.self="notice.open = false">
      <div class="notice-box">
        <h3>发通知</h3>
        <p class="muted tiny">窗口标题固定是「Mythclass消息通知」，下面的标题和内容由你写。</p>

        <label class="nt-row">
          <input type="checkbox" v-model="notice.topmost" />
          <span>置顶显示（压在其他窗口上面）</span>
        </label>
        <label class="nt-row">
          <input type="checkbox" v-model="notice.fullscreen" />
          <span>全屏显示（占满整块屏幕）</span>
        </label>

        <p class="nt-label">标题</p>
        <input class="nt-input" v-model="notice.title" maxlength="40" placeholder="比如：第三节自习安排" />

        <p class="nt-label">内容</p>
        <textarea class="nt-input" v-model="notice.body" rows="3" maxlength="300"
                  placeholder="比如：请把作业交到讲台，交完再看书。"></textarea>

        <p class="nt-label">回复选项（最多三个，勾上才显示）</p>
        <div v-for="(o, i) in notice.opts" :key="i" class="nt-opt">
          <label class="nt-row">
            <input type="checkbox" v-model="o.on" />
            <span class="nt-slot">
              {{ i === 0 ? '高亮按钮' : i === 1 ? '普通按钮' : '输入框' }}
            </span>
          </label>
          <input class="nt-input" v-model="o.label" maxlength="12"
                 :placeholder="i === 2 ? '输入框的提示文字，比如：写下你的想法' : '按钮上的字，比如：知道了'" />
        </div>

        <div class="nt-actions">
          <button class="btn gh" @click="notice.open = false">取消</button>
          <button class="btn pm" @click="sendNotice">发出去</button>
        </div>
      </div>
    </div>

    <button
      class="edge-toggle right"
      :class="{ off: !eventsOpen }"
      :title="eventsOpen ? '收起「事件 / 消息」' : '展开「事件 / 消息」'"
      @click="toggleEvents(!eventsOpen)"
    >
      <iconify-icon :icon="eventsOpen ? 'ph:caret-right' : 'ph:caret-left'"></iconify-icon>
    </button>

    <!-- 顶部工具条 -->
    <div class="top-bar">
      <button
        v-for="t in quickTools"
        :key="t.key"
        class="tool"
        :disabled="!selected || !selectedOnline"
        @click="t.run()"
      >
        <iconify-icon :icon="t.icon"></iconify-icon>
        <span>{{ t.label }}</span>
      </button>
      <p class="top-now mono">{{ selected ? selected.name || selected.clientUid : '先选一台机器' }}</p>
    </div>

    <!-- 左侧：机器缩略图墙 -->
    <aside class="rail">
      <div class="rail-head">
        <p class="eyebrow">我的机器</p>
        <div class="rail-acts">
          <button class="btn small primary" @click="bindDialog.open = true">
            <iconify-icon icon="ph:plus"></iconify-icon>绑定
          </button>
        </div>
      </div>

      <p class="rail-sum mono">{{ clients.length }} 台 · 在线 {{ auth.onlineCount }}</p>

      <div v-if="loading" class="rail-empty muted">正在拉列表…</div>
      <div v-else-if="!clients.length" class="rail-empty">
        <p class="muted">还没有机器。</p>
        <p class="muted">去一体机上打开客户端，抄下它的 ID，再点上面的「绑定」。</p>
      </div>

      <ul class="client-grid">
        <li
          v-for="c in clients"
          :key="c.id"
          :class="['cell', { active: c.id === selectedId }]"
          @click="selectClient(c)"
        >
          <div class="thumb">
            <img v-if="thumbs[c.id]" :src="thumbs[c.id]" :alt="c.name || c.clientUid" />
            <div v-else class="thumb-empty">
              <iconify-icon icon="ph:monitor"></iconify-icon>
            </div>
            <span :class="['live', auth.presence[c.id] ? 'on' : '']"></span>
          </div>
          <p class="cname">{{ c.name || '未命名一体机' }}</p>
        </li>
      </ul>

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

            <span
              class="pill"
              :class="{ on: transport === 'relay' || transport === 'p2p' }"
              :title="transportHint"
            >
              <iconify-icon
                :icon="transport === 'p2p' ? 'ph:lightning' : transport === 'relay' ? 'ph:cloud-arrow-down' : 'ph:circle-dashed'"
              ></iconify-icon>
              {{ transportLabel }}
            </span>
            <button
              v-if="selectedId"
              class="lan-go p2p-try"
              :disabled="p2pTrying"
              :title="
                transport === 'p2p'
                  ? '现在是直连。点一下可以断开重连再试'
                  : '手动再试一次 P2P 直连（画面不经过服务器）'
              "
              @click="manualP2P()"
            >
              <iconify-icon
                :icon="p2pTrying ? 'ph:spinner-gap' : 'ph:plugs-connected'"
              ></iconify-icon>
              {{ p2pTrying ? '正在试…' : transport === 'p2p' ? '重连直连' : '试直连' }}
            </button>
            <span
              v-if="sameLan"
              class="lan-chip"
              :title="sameLanHint"
            >
              <Icon icon="ph:house-line" />
              同一局域网
            </span>
            <button
              v-if="sameLan"
              class="lan-go"
              :title="'打开这台机器自己开的页面（' + lanPageUrl(selected) + '）'"
              @click="askDirect(selected)"
            >
              <Icon icon="ph:arrow-square-out" />
              走直连
            </button>
            <span class="mono stat">{{ frameSize || '—' }} · {{ frameFps }} fps</span>
            <span class="mono stat">{{ rtt === null ? '延迟 —' : '延迟 ' + rtt + ' ms' }}</span>
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
              <div v-if="transport === 'p2p' && lanPageUrl(selected)" class="direct-dock">
            <div class="dd-left">
              <span class="dd-tag"><Icon icon="ph:lightning" />已直连</span>
              <span class="dd-text">
                画面走 P2P，不占服务器带宽。还能打开它自己跑的控制台 ——
                锁屏、关机、发消息都在那边，一样不走服务器。
              </span>
            </div>
            <button class="dd-go" @click="openLanConsole(selected)">
              <Icon icon="ph:monitor-play" />
              打开局域网控制台
            </button>
          </div>

          <p class="muted tiny">先试 P2P 直连，连不上自动走服务端中继。工具栏右侧会显示当前走的是哪条路。</p>
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

    <!-- 右侧：事件 / 消息（极域右边那一栏） -->
    <aside class="events">
      <div class="ev-tabs">
        <button :class="['ev-tab', { active: evTab === 'event' }]" @click="evTab = 'event'">事件</button>
        <button :class="['ev-tab', { active: evTab === 'message' }]" @click="evTab = 'message'">消息</button>
      </div>
      <ul class="ev-list">
        <li v-for="(e, i) in evList" :key="i">
          <span class="ev-time mono">{{ e.time }}</span>
          <span class="ev-text">{{ e.text }}</span>
        </li>
        <li v-if="!evList.length" class="muted tiny">
          {{ evTab === 'event' ? '还没发过命令。' : '机器上下线会记在这儿。' }}
        </li>
      </ul>
    </aside>

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
/* 通知编辑框 */
.notice-mask {
  position: fixed; inset: 0; z-index: 200;
  display: grid; place-items: center;
  background: rgba(6, 10, 8, 0.62);
  backdrop-filter: blur(3px);
}
.notice-box {
  width: min(560px, 92vw); max-height: 88vh; overflow: auto;
  padding: 20px 22px 18px;
  border: 1px solid var(--line); border-radius: 16px;
  background: var(--panel); color: var(--text);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}
.notice-box h3 { margin: 0 0 6px; font-size: 16px; }
.nt-label { margin: 14px 0 6px; font-size: 12.5px; color: var(--sage); }
.nt-input {
  width: 100%; padding: 9px 11px; border-radius: 9px; font: inherit; font-size: 13.5px;
  background: #0f1613; color: var(--text); border: 1px solid var(--line);
}
.nt-row { display: flex; align-items: center; gap: 8px; font-size: 13.5px; cursor: pointer; }
.nt-opt {
  display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: 10px;
  align-items: center; margin-bottom: 8px;
}
.nt-slot { color: var(--sage); font-size: 12.5px; }
.nt-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.btn.gh { background: transparent; border: 1px solid var(--line); color: var(--sage); }
.btn.pm { background: #3f6b52; border: 1px solid #4c7d61; color: #f1f6ef; }

/* 直连成功后出现的管理栏：告诉老师「还能进它自己的控制台」 */
.direct-dock {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0 6px;
  padding: 12px 14px;
  border: 1px solid rgba(94, 154, 115, 0.4);
  border-radius: 12px;
  background:
    radial-gradient(520px 160px at 6% -40%, rgba(94, 154, 115, 0.18), transparent 70%),
    rgba(20, 27, 23, 0.85);
}
.dd-left { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.dd-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(94, 154, 115, 0.5);
  background: rgba(94, 154, 115, 0.16);
  color: #c9e6d2;
  font-size: 12.5px;
  white-space: nowrap;
}
.dd-text { color: #9fb79c; font-size: 13px; }
.dd-go {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid #4c7d61;
  border-radius: 9px;
  background: #3f6b52;
  color: #f1f6ef;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.dd-go:hover { background: #4a7d60; }

/* 「走直连」按钮：跟「同一局域网」标记挨着，点开就是一体机自己的页面 */
.lan-go {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid rgba(94, 154, 115, 0.55);
  border-radius: 999px;
  background: rgba(94, 154, 115, 0.18);
  color: #c9e6d2;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
}
.lan-go:hover { background: rgba(94, 154, 115, 0.3); }

/* 手动试直连那个按钮 */
.p2p-try { margin-right: 2px; }
.p2p-try:disabled { opacity: 0.7; cursor: progress; }
.p2p-try iconify-icon { font-size: 14px; }

/* 「同一局域网」小标记：跟传输通道药丸并排，别抢眼但要看得见 */
.lan-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border: 1px solid rgba(94, 154, 115, 0.45);
  border-radius: 999px;
  background: rgba(94, 154, 115, 0.12);
  color: #9fd0ac;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}

.dash {
  position: relative;
  display: grid;
  grid-template-columns: var(--rail-w, 296px) minmax(0, 1fr) var(--ev-w, 268px);
  grid-template-rows: auto minmax(0, 1fr);
  min-height: calc(100vh - 62px);
  transition: grid-template-columns 0.28s ease;
}
/* 缩进屏幕外：列宽收成 0，面板淡出 */
.dash.rail-off { --rail-w: 0px; }
.dash.events-off { --ev-w: 0px; }
.dash.rail-off .rail,
.dash.events-off .events {
  overflow: hidden;
  padding-left: 0;
  padding-right: 0;
  border-width: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}
/* 贴屏幕左右边缘的伸缩条：固定在竖直中间，只要一个箭头图标 */
.edge-toggle {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 40;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 64px;
  padding: 0;
  border: 1px solid rgba(143, 168, 142, 0.22);
  background: color-mix(in srgb, var(--ink) 72%, transparent);
  color: var(--sage);
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}
.edge-toggle:hover {
  color: #c9e6d2;
  border-color: rgba(94, 154, 115, 0.55);
  background: color-mix(in srgb, var(--ink) 60%, rgba(94, 154, 115, 0.25));
}
.edge-toggle.left { left: 0; border-left: 0; border-radius: 0 10px 10px 0; }
.edge-toggle.right { right: 0; border-right: 0; border-radius: 10px 0 0 10px; }
/* 已经收起来的那侧，颜色淡一点，提示「点开能拉出来」 */
.edge-toggle.off { color: #9fd0ac; border-color: rgba(94, 154, 115, 0.45); }
/* 面板头上的小按钮（绑定旁边那个收起） */
.rail-acts { display: flex; align-items: center; gap: 6px; }
.icon-mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid rgba(143, 168, 142, 0.22);
  background: transparent;
  color: var(--sage);
  cursor: pointer;
}
.icon-mini:hover { color: var(--text); border-color: rgba(94, 154, 115, 0.5); }
.ev-fold { margin-left: auto; }

/* ------------------------------ 顶部工具条 ------------------------------ */
.top-bar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--ink) 74%, transparent);
  backdrop-filter: blur(8px);
  z-index: 2;
}
.tool {
  display: grid;
  justify-items: center;
  gap: 3px;
  min-width: 66px;
  padding: 7px 8px 6px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: background 0.16s, color 0.16s, border-color 0.16s;
}
.tool iconify-icon { font-size: 19px; }
.tool span { font-size: 11.5px; }
.tool:hover:not(:disabled) {
  background: rgba(243, 239, 227, 0.07);
  color: var(--text);
  border-color: rgba(143, 168, 142, 0.3);
}
.tool:disabled { opacity: 0.35; cursor: not-allowed; }
.top-now { margin: 0 0 0 auto; font-size: 12px; color: var(--sage); }

/* --------------------------------- 侧栏 --------------------------------- */
.rail {
  grid-row: 2;
  border-right: 1px solid var(--line);
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: color-mix(in srgb, var(--ink) 58%, transparent);
  backdrop-filter: blur(6px);
  min-height: 0;
  z-index: 1;
}
.rail-head { display: flex; align-items: center; justify-content: space-between; }
.rail-head .eyebrow { margin: 0; }
.rail-sum { font-size: 12px; color: var(--sage); margin: 0; }
.rail-empty { font-size: 13px; line-height: 1.7; }
/* 机器墙：一格一台，跟极域一样 */
.client-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 10px;
  overflow-y: auto;
  align-content: start;
}
.cell {
  display: grid;
  gap: 5px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}
.cell:hover { background: rgba(243, 239, 227, 0.05); }
.cell.active {
  background: rgba(63, 107, 82, 0.28);
  border-color: rgba(143, 168, 142, 0.45);
}
.thumb {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 7px;
  overflow: hidden;
  background: rgba(8, 14, 10, 0.75);
  border: 1px solid rgba(143, 168, 142, 0.22);
  display: grid;
  place-items: center;
}
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-empty iconify-icon { font-size: 20px; color: rgba(143, 168, 142, 0.5); }
.cell .live { position: absolute; top: 5px; right: 5px; }
.cell .cname { font-size: 11.5px; text-align: center; }
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
.tiny { font-size: 11px; margin: 2px 0; word-break: break-all; }

/* --------------------------------- 工作区 --------------------------------- */
.work { grid-row: 2; padding: 18px 22px 40px; min-width: 0; overflow-y: auto; z-index: 1; }

/* ------------------------------ 右侧事件栏 ------------------------------ */
.events {
  grid-row: 2;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--line);
  background: color-mix(in srgb, var(--ink) 58%, transparent);
  backdrop-filter: blur(6px);
  min-height: 0;
  z-index: 1;
}
.ev-tabs { display: flex; border-bottom: 1px solid var(--line); }
.ev-tab {
  flex: 1;
  padding: 10px 0;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
}
.ev-tab.active { color: var(--text); box-shadow: inset 0 -2px 0 var(--moss-2); }
.ev-list { list-style: none; margin: 0; padding: 10px 12px; display: grid; gap: 7px; overflow-y: auto; }
.ev-list li { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.5; }
.ev-time { color: var(--sage); flex: 0 0 auto; }
.ev-text { color: var(--text-dim); word-break: break-all; }
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

@media (max-width: 1180px) {
  .dash { grid-template-columns: 250px minmax(0, 1fr); }
  .events { display: none; }
}

@media (max-width: 1000px) {
  .dash { grid-template-columns: 1fr; }
  .rail { border-right: 0; border-bottom: 1px solid var(--line); }
  .client-list { grid-auto-flow: column; overflow-x: auto; }
  .two { grid-template-columns: 1fr; }
}
</style>
