"""跟服务端打交道

两条路：
- REST（requests）：注册、心跳、上报记录
- WebSocket：自己实现了最小可用的 Engine.IO v4 + Socket.IO 帧，省一个依赖

协议细节见 docs/通信协议.md
"""

from __future__ import annotations

import json
import ssl
import threading
import time
from typing import Callable

import requests
import websocket

from . import __version__, config, identity

DEFAULT_TIMEOUT = 15


def http_base(ws_url: str) -> str:
    """wss://x → https://x"""
    url = (ws_url or "").strip().rstrip("/")
    if url.startswith("wss://"):
        return "https://" + url[6:]
    if url.startswith("ws://"):
        return "http://" + url[5:]
    if url.startswith("http"):
        return url
    return "https://" + url


def socket_url(ws_url: str) -> str:
    url = (ws_url or "").strip().rstrip("/")
    if not url.startswith(("ws://", "wss://")):
        url = "wss://" + url
    return f"{url}/socket.io/?EIO=4&transport=websocket"


class ServerApi:
    """REST 那一半"""

    def __init__(self, base: str):
        self.base = http_base(base)
        self.session = requests.Session()
        self.token = ""

    def _headers(self) -> dict:
        head = {"Content-Type": "application/json"}
        if self.token:
            head["Authorization"] = f"Bearer {self.token}"
        return head

    def register(self, client_uid: str, name: str) -> dict:
        resp = self.session.post(
            f"{self.base}/api/client/register",
            json={
                "clientUid": client_uid,
                "name": name,
                "os": identity.os_description(),
                "version": __version__,
            },
            headers=self._headers(),
            timeout=DEFAULT_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        self.token = data.get("token", "")
        return data

    def heartbeat(self) -> bool:
        try:
            resp = self.session.post(
                f"{self.base}/api/client/heartbeat", headers=self._headers(), timeout=DEFAULT_TIMEOUT
            )
            return resp.ok
        except requests.RequestException:
            return False

    def upload_file_logs(self, logs: list[dict]) -> bool:
        if not logs:
            return True
        payload = {
            "logs": [
                {
                    "timestamp": item.get("timestamp"),
                    "operation": item.get("operation"),
                    "filePath": item.get("file_path"),
                    "fileSize": item.get("file_size"),
                }
                for item in logs
            ]
        }
        try:
            resp = self.session.post(
                f"{self.base}/api/client/file-logs",
                json=payload,
                headers=self._headers(),
                timeout=DEFAULT_TIMEOUT,
            )
            return resp.ok
        except requests.RequestException:
            return False

    def upload_audio(self, items: list[dict]) -> bool:
        if not items:
            return True
        try:
            resp = self.session.post(
                f"{self.base}/api/client/audio-info",
                json={"items": items},
                headers=self._headers(),
                timeout=DEFAULT_TIMEOUT,
            )
            return resp.ok
        except requests.RequestException:
            return False

    def command_result(self, request_id: str, command: str, ok: bool, output: str) -> None:
        try:
            self.session.post(
                f"{self.base}/api/client/command-result",
                json={"requestId": request_id, "command": command, "ok": ok, "output": output[:1500]},
                headers=self._headers(),
                timeout=DEFAULT_TIMEOUT,
            )
        except requests.RequestException:
            pass


class SocketClient:
    """WebSocket 那一半。自己解 Engine.IO v4 的帧。"""

    def __init__(
        self,
        ws_url: str,
        token: str,
        on_event: Callable[[str, dict], None],
        on_state: Callable[[bool], None] | None = None,
        on_ready: Callable[[], None] | None = None,
    ):
        self.url = socket_url(ws_url)
        self.token = token
        self.on_event = on_event
        self.on_state = on_state or (lambda _s: None)
        self.on_ready = on_ready or (lambda: None)

        self._ws: websocket.WebSocket | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._outbox: list[str] = []
        self._lock = threading.Lock()
        self.connected = False

    # ------------------------------ 生命周期 ------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="mythclass-socket", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        try:
            if self._ws:
                self._ws.close()
        except Exception:
            pass

    def emit(self, event: str, payload: dict | None = None) -> None:
        frame = "42" + json.dumps([event, payload] if payload is not None else [event], ensure_ascii=False)
        with self._lock:
            self._outbox.append(frame)

    # -------------------------------- 内部 --------------------------------

    def _loop(self) -> None:
        backoff = 2
        while not self._stop.is_set():
            try:
                self._connect_once()
                backoff = 2
            except Exception:
                self.connected = False
                self.on_state(False)
            if self._stop.is_set():
                break
            # 断线重连：慢慢退避，最多 60 秒
            self._stop.wait(backoff)
            backoff = min(backoff * 2, 60)

    def _connect_once(self) -> None:
        ws = websocket.create_connection(
            self.url,
            timeout=10,
            sslopt={"cert_reqs": ssl.CERT_REQUIRED},
            enable_multithread=True,
        )
        self._ws = ws

        # 1) 握手包：0{"sid":...}
        handshake = ws.recv()
        if not isinstance(handshake, str) or not handshake.startswith("0"):
            raise ConnectionError(f"握手失败：{handshake!r}")

        # 2) Socket.IO CONNECT，把 token 塞进 auth
        ws.send("40" + json.dumps({"token": self.token}))
        ws.settimeout(10)
        ack = ws.recv()
        if isinstance(ack, str) and ack.startswith("44"):
            raise ConnectionError(f"服务端不认这个凭证：{ack[2:]}")

        self.connected = True
        self.on_state(True)
        self.on_ready()

        ws.settimeout(1.0)
        last_heartbeat = 0.0

        while not self._stop.is_set():
            # 发心跳事件（每 20 秒）
            if time.time() - last_heartbeat > 20:
                self.emit("heartbeat")
                last_heartbeat = time.time()

            # 把攒着的帧发出去
            with self._lock:
                pending, self._outbox = self._outbox, []
            for frame in pending:
                ws.send(frame)

            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                break

            if not raw:
                continue
            if not isinstance(raw, str):
                continue
            self._handle(raw)

        self.connected = False
        self.on_state(False)
        try:
            ws.close()
        except Exception:
            pass
        self._ws = None

    def _handle(self, raw: str) -> None:
        # Engine.IO 层
        if raw == "2":  # ping → pong
            try:
                self._ws.send("3")
            except Exception:
                pass
            return
        if raw == "1":  # server close
            raise ConnectionError("服务端关掉了连接")

        if not raw.startswith("4"):
            return

        packet = raw[1:]
        if packet.startswith("2"):  # 42["event", {...}]
            try:
                data = json.loads(packet[1:])
            except json.JSONDecodeError:
                return
            if isinstance(data, list) and data:
                event = data[0]
                payload = data[1] if len(data) > 1 else {}
                try:
                    self.on_event(event, payload if isinstance(payload, dict) else {"value": payload})
                except Exception:
                    pass
        # 40 = connect ack，41 = disconnect，忽略就好
