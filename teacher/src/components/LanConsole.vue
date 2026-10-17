<script setup>
/**
 * 局域网控制台（走服务器中转）
 *
 * 页面本体是直接问那台一体机要的 —— 和它自己的局域网控制台是**同一份 HTML**，
 * 所以永远一模一样，不用维护两份。
 *
 * 唯一动的手脚：把它发出去的 /api/xxx 请求改道到 /api/lan/relay，
 * 由服务器转给那台机器；页面自己完全不知情，照常工作。
 *
 * 两种用法：
 *   · standalone（默认）：整屏铺开，和控制台那个老地址一样，带「回控制台」
 *   · inline：嵌在控制台里就地换界面用 —— 地址栏不动，导航栏那个
 *     「新界面 / 旧界面」按钮负责来回切
 */
import { onMounted, ref, watch } from 'vue';
import { HTTP_BASE, request, tokenStore } from '@/api';

const props = defineProps({
  clientId: { type: Number, default: 0 },
  inline: { type: Boolean, default: false },
});
const emit = defineEmits(['back']);

const html = ref('');
const failure = ref('');
const loading = ref(true);
const clientName = ref('');

/** 注入到页面里的那段：把 fetch 和 window.open 接到中转上 */
function patchSource(cid = 0) {
  const token = tokenStore.get();
  return [
    '<' + 'script>',
    '(function () {',
    '  var CID = ' + Number(cid || 0) + ';',
    '  var TOKEN = ' + JSON.stringify(token) + ';',
    '  var ENDPOINT = ' + JSON.stringify(HTTP_BASE + '/api/lan/relay') + ';',
    '  var realFetch = window.fetch.bind(window);',
    '',
    '  function b64(bytes) {',
    '    var s = "";',
    '    var chunk = 0x8000;',
    '    for (var i = 0; i < bytes.length; i += chunk) {',
    '      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));',
    '    }',
    '    return btoa(s);',
    '  }',
    '',
    '  // 把请求体变成 base64（JSON 好办；FormData 要在浏览器这边拼成 multipart）',
    '  function encodeBody(body, headers) {',
    '    if (body === undefined || body === null) return Promise.resolve({ b64: "", type: "" });',
    '    if (typeof body === "string") {',
    '      var enc = new TextEncoder().encode(body);',
    '      return Promise.resolve({ b64: b64(enc), type: (headers && headers["Content-Type"]) || "text/plain" });',
    '    }',
    '    if (window.FormData && body instanceof window.FormData) {',
    '      var boundary = "----mythrelay" + Math.random().toString(16).slice(2);',
    '      var parts = [];',
    '      var jobs = [];',
    '      body.forEach(function (v, k) {',
    '        if (v && typeof v === "object" && v.name !== undefined) {',
    '          jobs.push(v.arrayBuffer().then(function (buf) {',
    '            return { key: k, filename: v.name, data: new Uint8Array(buf) };',
    '          }));',
    '        } else {',
    '          parts.push({ key: k, value: String(v) });',
    '        }',
    '      });',
    '      return Promise.all(jobs).then(function (files) {',
    '        var chunks = [];',
    '        function push(str) { chunks.push(new TextEncoder().encode(str)); }',
    '        files.forEach(function (f) {',
    '          push("--" + boundary + "\\r\\n");',
    '          push("Content-Disposition: form-data; name=\\"" + f.key + "\\"; filename=\\"" + f.filename + "\\"\\r\\n");',
    '          push("Content-Type: application/octet-stream\\r\\n\\r\\n");',
    '          chunks.push(f.data);',
    '          push("\\r\\n");',
    '        });',
    '        parts.forEach(function (p) {',
    '          push("--" + boundary + "\\r\\n");',
    '          push("Content-Disposition: form-data; name=\\"" + p.key + "\\"\\r\\n\\r\\n");',
    '          push(p.value + "\\r\\n");',
    '        });',
    '        push("--" + boundary + "--\\r\\n");',
    '        var total = chunks.reduce(function (n, c) { return n + c.length; }, 0);',
    '        var all = new Uint8Array(total);',
    '        var at = 0;',
    '        chunks.forEach(function (c) { all.set(c, at); at += c.length; });',
    '        return { b64: b64(all), type: "multipart/form-data; boundary=" + boundary };',
    '      });',
    '    }',
    '    return Promise.resolve({ b64: "", type: "" });',
    '  }',
    '',
    '  window.fetch = function (input, init) {',
    '    var url = (typeof input === "string") ? input : ((input && input.url) || "");',
    '    // 注意：画面是 /frame（不在 /api/ 下面），漏了它就会被原样放行、',
    '    // 打到教师端自己的域名上拿回一份 index.html（图就永远是裂的）',
    '    if (url.indexOf("/api/") !== 0 && url.indexOf("/frame") !== 0) {',
    '      return realFetch(input, init);',
    '    }',
    '    var opts = init || {};',
    '    var qs = "";',
    '    var path = url;',
    '    var mark = url.indexOf("?");',
    '    if (mark >= 0) { path = url.slice(0, mark); qs = url.slice(mark + 1); }',
    '    var headers = opts.headers || {};',
    '    return encodeBody(opts.body, headers).then(function (enc) {',
    '      return realFetch(ENDPOINT, {',
    '        method: "POST",',
    '        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },',
    '        body: JSON.stringify({',
    '          clientId: CID, method: opts.method || "GET", path: path, query: qs,',
    '          body: enc.b64, contentType: enc.type',
    '        })',
    '      });',
    '    }).then(function (r) { return r.json(); }).then(function (d) {',
    '      if (!d || d.ok === false) {',
    '        return new Response(JSON.stringify({ ok: false, error: (d && d.error) || "中转失败" }),',
    '          { status: 502, headers: { "Content-Type": "application/json" } });',
    '      }',
    '      var bin = atob(d.body || "");',
    '      var arr = new Uint8Array(bin.length);',
    '      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);',
    '      return new Response(arr, {',
    '        status: d.status || 200,',
    '        headers: { "Content-Type": d.contentType || "application/json" }',
    '      });',
    '    });',
    '  };',
    '',
    '  // 这条副标题是页面自己写的，写着"不经过服务器" —— 在这儿得改成实话',
    '  function fixSub() {',
    '    var el = document.getElementById("sub");',
    '    if (!el) return;',
    '    var now = String(el.textContent || "");',
    '    // 一定得先判断：不然"写回同样的值"也算一次变更，观察者会自己叫自己，页面冻死',
    '    if (now.indexOf("不经过服务器") < 0) return;',
    '    el.textContent = now.replace("直连这台机器 · 不经过服务器", "经服务器中转 · 数据过一趟服务器");',
    '  }',
    '  document.addEventListener("DOMContentLoaded", function () {',
    '    fixSub();',
    '    var el = document.getElementById("sub");',
    '    if (el && window.MutationObserver) {',
    '      new MutationObserver(fixSub).observe(el, { childList: true, characterData: true, subtree: true });',
    '    }',
    '  });',
    '',
    '  // 屏幕流是 img.src = "/frame?t=..." 拉的 —— 连 fetch 都不是，',
    '  // 不罩住它的话，这个请求会打到教师端自己的域名上（404，画面全白）',
    '  var realSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");',
    '  Object.defineProperty(HTMLImageElement.prototype, "src", {',
    '    configurable: true,',
    '    get: function () { return realSrc.get.call(this); },',
    '    set: function (value) {',
    '      var url = String(value == null ? "" : value);',
    '      if (url.indexOf("/frame") !== 0) { realSrc.set.call(this, value); return; }',
    '      var el = this;',
    '      window.fetch(url).then(function (r) {',
    '        var ctype = String(r.headers.get("Content-Type") || "");',
    '        // 抓不到时一体机回的是 JSON（写着为什么）。这种情况别接管 ——',
    '        // 把原始地址放回去，页面自己会把原因读出来显示，跟直连时一样。',
    '        if (r.status !== 200 || ctype.indexOf("image/") !== 0) {',
    '          // 抓不到：把一体机说的原因写进页面自己的提示行。',
    '          // 教师端那条杠上不再另开一行报错 —— 这里说清楚就够了，',
    '          // 不然画面一卡，顶上就挂一条长长的提示，看着像整页都坏了。',
    '          r.json().then(function (d) {',
    '            var why = (d && (d.message || d.error)) || "抓不到画面";',
    '            var hint = document.getElementById("hint");',
    '            if (hint) hint.textContent = why;',
    '          }).catch(function () {});',
    '          realSrc.set.call(el, url);',
    '          return null;',
    '        }',
    '        return r.blob();',
    '      }).then(function (blob) {',
    '        if (!blob) return;',
    '        var old = el.__mythBlob;',
    '        var next = URL.createObjectURL(blob);',
    '        el.__mythBlob = next;',
    '        realSrc.set.call(el, next);',
    '        if (old) setTimeout(function () { URL.revokeObjectURL(old); }, 1500);',
    '      }).catch(function () { realSrc.set.call(el, url); });',
    '    }',
    '  });',
    '',
    '  // 下载是 window.open 开的，也接过来（不然会打到教师端自己的地址上）',
    '  var realOpen = window.open;',
    '  window.open = function (url, name, feat) {',
    '    if (String(url || "").indexOf("/api/") !== 0) return realOpen(url, name, feat);',
    '    window.fetch(url).then(function (r) { return r.blob(); }).then(function (blob) {',
    '      var a = document.createElement("a");',
    '      a.href = URL.createObjectURL(blob);',
    '      a.download = String(url).split("path=").pop().split("/").pop() || "download";',
    '      document.body.appendChild(a);',
    '      a.click();',
    '      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);',
    '    }).catch(function () {});',
    '    return null;',
    '  };',
    '})();',
    '<' + '/script>'
  ].join('\n');
}

async function load() {
  loading.value = true;
  failure.value = '';
  try {
    const target = Number(props.clientId || 0);
    if (!target) throw new Error('没说要连哪台机器，先回控制台选一台。');

    const data = await request('/lan/relay', {
      method: 'POST',
      timeout: 40000,
      body: { clientId: target, method: 'GET', path: '/', query: '' },
    });
    if (!data || data.ok === false || !data.body) throw new Error((data && data.error) || '那台机器没给页面');

    const bin = atob(data.body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const raw = new TextDecoder('utf-8').decode(bytes);
    // 页面里带个标题栏用的名字
    try {
      const m = raw.match(/<title>([^<]*)<\/title>/);
      if (m) clientName.value = m[1];
    } catch (_) {
      /* 没标题就算了 */
    }

    const patch = patchSource(target);
    html.value = raw.includes('</head>') ? raw.replace('</head>', patch + '</head>') : patch + raw;
  } catch (err) {
    const msg = err.message || String(err);
    // 把"到底哪儿不对"说清楚：服务器没更新 / 机器没上线 / 网络不通
    if (/连不上服务端|请求超时/.test(msg)) {
      failure.value =
        '服务器那边没应这个接口。多半是服务端还没更新到带中转的版本 —— ' +
        '去服务器上 git pull 再重启一次。';
    } else if (/NOT_FOUND|接口不存在/.test(msg)) {
      failure.value = '服务器没有 /api/lan/relay 这个接口，先把服务端更新一下。';
    } else {
      failure.value = msg;
    }
  } finally {
    loading.value = false;
  }
}

// 换机器就地重来：不用刷新整页
watch(() => props.clientId, () => load());

onMounted(load);
</script>

<template>
  <div class="lanui" :class="inline ? 'inline' : 'standalone'">
    <div class="bar">
      <button v-if="!inline" class="btn small" @click="emit('back')">← 回控制台</button>
      <span class="who">{{ clientName || '局域网界面' }}</span>
      <span class="tag">走服务器中转</span>
      <button class="btn small ghost" @click="load">重新加载</button>
    </div>

    <p v-if="loading" class="note">正在问那台机器要页面…</p>
    <p v-else-if="failure" class="note bad">
      {{ failure }}
      <br />
      要么服务端没更新，要么这台机器没连上服务器（它的版本也得是 3.0.0.13 以上）。
    </p>
    <iframe v-else class="frame" :srcdoc="html" title="局域网界面"></iframe>
  </div>
</template>

<style scoped>
.lanui {
  display: flex;
  flex-direction: column;
  background: var(--ink);
}
/* 老地址那套：整屏铺开，压住导航栏 */
.lanui.standalone {
  position: fixed;
  inset: 0;
  top: 0;
  z-index: 60;
}
/* 就地换界面那套：待在导航栏下面的内容区里，地址栏不动 */
.lanui.inline {
  position: relative;
  min-height: calc(100vh - 62px);
}
.bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--ink) 88%, transparent);
  backdrop-filter: blur(10px);
}
.who {
  font-size: 13px;
  color: #c9e6d2;
}
.tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(94, 154, 115, 0.45);
  color: #9ecbac;
}
.note {
  padding: 40px 22px;
  color: #cfd8d2;
  font-size: 14px;
}
.note.bad {
  color: #e69a90;
}
.frame {
  flex: 1;
  width: 100%;
  min-height: 70vh;
  border: 0;
  background: #0a0f0c;
}
</style>
