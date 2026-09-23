"""Mythclass 客户端主程序

python -m mythclass              正常启动（托盘 + 后台）
python -m mythclass --guard <pid> 守护模式，盯住主进程
python -m mythclass --console    前台跑，日志直接打屏上（调试用）
python -m mythclass --status     打印状态就退出
"""

from __future__ import annotations

import ctypes
import logging
import sys
import threading
import time

from . import __product__, __version__, config, guard, identity
from .api import ServerApi, SocketClient
from .commands import execute, known_commands
from .db import RecordStore
from .monitors import AudioMonitor, FileMonitor, ScreenStreamer
from .tray import Tray

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


class MythclassClient:
    def __init__(self, console: bool = False):
        self.cfg = config.load()
        self.client_uid = identity.resolve_uid(self.cfg)
        self.store = RecordStore()
        self.console = console

        self.server_url = ""
        self.api: ServerApi | None = None
        self.socket: SocketClient | None = None
        self.connected = False

        self.file_monitor: FileMonitor | None = None
        self.audio_monitor: AudioMonitor | None = None
        self.screen = ScreenStreamer(self.cfg.get("screenFps", 12), self.cfg.get("screenQuality", 60))

        self.tray = Tray(self)
        self._stop = threading.Event()
        self.logger = logging.getLogger("mythclass")

    # ------------------------------ 日志 ------------------------------

    def log(self, message: str, level: int = logging.INFO) -> None:
        self.logger.log(level, message)
        if self.console:
            print(f"[Mythclass] {message}", flush=True)

    # ------------------------------ 连接 ------------------------------

    def _connect_loop(self) -> None:
        """按官方 → 自定义的顺序挨个试，全挂了就等一会儿再来"""
        backoff = 5
        while not self._stop.is_set():
            for url in config.enabled_servers(self.cfg):
                if self._stop.is_set():
                    return
                try:
                    api = ServerApi(url)
                    info = api.register(self.client_uid, self.cfg.get("clientName") or "教室一体机")
                    self.api = api
                    self.server_url = url
                    self.log(f"已经连上 {url}（机器号 {self.client_uid}）")

                    # 服务端那边的保留策略，以它为准
                    settings = (info.get("server") or {})
                    if settings.get("relayEnabled") is False:
                        self.log("服务端关了中继，只能靠 P2P。")

                    self.socket = SocketClient(url, api.token, self._on_event, self._on_state, self._on_ready)
                    self.socket.start()
                    backoff = 5
                    self._wait_until_disconnected()
                    break
                except Exception as err:
                    self.log(f"{url} 连不上：{err}", logging.WARNING)

            if self._stop.is_set():
                return
            self._stop.wait(backoff)
            backoff = min(backoff * 2, 60)

    def _wait_until_disconnected(self) -> None:
        """连上之后就在这儿盯着，直到连接断开"""
        while not self._stop.is_set():
            if self.socket and not self.socket.connected:
                # 给了它几次重连的机会
                time.sleep(3)
                if self.socket and not self.socket.connected:
                    self.log("连接断了，重新找服务器。", logging.WARNING)
                    return
            time.sleep(1)

    def _on_state(self, connected: bool) -> None:
        self.connected = connected
        if connected:
            self.tray.notify("已经连上服务端。")

    def _on_ready(self) -> None:
        self.socket.emit(
            "hello",
            {"clientUid": self.client_uid, "name": self.cfg.get("clientName"), "version": __version__},
        )

    # ---------------------------- 服务端事件 ----------------------------

    def _on_event(self, event: str, payload: dict) -> None:
        if event == "command":
            threading.Thread(target=self._handle_command, args=(payload,), daemon=True).start()
        elif event == "control_event":
            self._handle_control(payload)
        elif event == "settings:update":
            self._apply_settings(payload.get("settings") or {})
        elif event in ("heartbeat:ack", "registered", "client:presence"):
            pass
        else:
            self.log(f"收到不认识的事件：{event}", logging.DEBUG)

    def _handle_command(self, payload: dict) -> None:
        command = str(payload.get("command") or "")
        args = payload.get("args") or {}
        request_id = payload.get("requestId") or ""

        if command == "screen_start":
            if not self.screen.running:
                self.screen = ScreenStreamer(
                    args.get("fps", self.cfg.get("screenFps", 12)),
                    args.get("quality", self.cfg.get("screenQuality", 60)),
                )
                self.screen.start(lambda frame: self.socket and self.socket.emit("screen_frame", frame))
            ok, output = True, "屏幕流开着了"
        elif command == "screen_stop":
            self.screen.stop()
            ok, output = True, "屏幕流关了"
        elif command == "request_frame":
            ok, output = True, "收到，流已经在推"
        else:
            ok, output = execute(command, args)

        self.log(f"命令 {command}：{'成功' if ok else '失败'} - {output}")
        if request_id:
            threading.Thread(
                target=lambda: self.api and self.api.command_result(request_id, command, ok, output), daemon=True
            ).start()
        if self.socket:
            self.socket.emit("command_result", {"requestId": request_id, "command": command, "ok": ok, "output": output})

    def _handle_control(self, payload: dict) -> None:
        """老师的鼠标键盘，落到这台机器上"""
        event = payload.get("event") or payload
        kind = event.get("type")
        try:
            import pyautogui  # type: ignore

            pyautogui.FAILSAFE = False
            screen_w, screen_h = pyautogui.size()
            if kind == "mousemove":
                pyautogui.moveTo(int(event.get("x", 0) * screen_w), int(event.get("y", 0) * screen_h))
            elif kind == "mousedown":
                pyautogui.mouseDown(button=event.get("button", "left"))
            elif kind == "mouseup":
                pyautogui.mouseUp(button=event.get("button", "left"))
            elif kind == "key":
                pyautogui.press(str(event.get("key", ""))[:20])
        except ImportError:
            self._control_fallback(event, kind)
        except Exception as err:
            self.log(f"控制事件没执行：{err}", logging.WARNING)

    @staticmethod
    def _control_fallback(event: dict, kind: str) -> None:
        """没装 pyautogui 就用 user32 顶上"""
        if sys.platform != "win32":
            return
        user32 = ctypes.windll.user32
        width = user32.GetSystemMetrics(0)
        height = user32.GetSystemMetrics(1)
        if kind == "mousemove":
            user32.SetCursorPos(int(event.get("x", 0) * width), int(event.get("y", 0) * height))
        elif kind == "mousedown":
            user32.mouse_event(0x0002, 0, 0, 0, 0)
        elif kind == "mouseup":
            user32.mouse_event(0x0004, 0, 0, 0, 0)

    def _apply_settings(self, settings: dict) -> None:
        if "maxLogCount" in settings:
            self.cfg["maxLogCount"] = int(settings["maxLogCount"])
        if "maxLogSize" in settings:
            self.cfg["maxLogSize"] = int(settings["maxLogSize"])
        config.save(self.cfg)
        self.log("记录保留策略被老师改了，已经落地。")

    # ------------------------------ 后台活 ------------------------------

    def _upload_loop(self) -> None:
        """攒着的记录往服务端送，顺手心跳"""
        while not self._stop.is_set():
            try:
                if self.api and self.connected:
                    logs = self.store.pending_file_logs()
                    if logs and self.api.upload_file_logs(logs):
                        self.store.mark_uploaded("file_logs", [item["id"] for item in logs])

                    audio = self.store.pending_audio_logs()
                    if audio and self.api.upload_audio(audio):
                        self.store.mark_uploaded("audio_logs", [item["id"] for item in audio])

                    self.api.heartbeat()
            except Exception as err:
                self.log(f"上报出问题了：{err}", logging.WARNING)
            self._stop.wait(15)

    def _housekeeping_loop(self) -> None:
        """每 5 分钟清一次旧记录"""
        while not self._stop.is_set():
            try:
                removed = self.store.trim(int(self.cfg.get("maxLogCount", 5000)), int(self.cfg.get("maxLogSize", 209715200)))
                if removed:
                    self.log(f"清掉了 {removed} 条旧记录")
            except Exception as err:
                self.log(f"清理失败：{err}", logging.WARNING)
            self._stop.wait(300)

    def on_settings_saved(self, cfg: dict) -> None:
        self.cfg = cfg
        self.log("设置更新了，部分项目下次启动才生效。")

    # ------------------------------ 生命周期 ------------------------------

    def start(self) -> None:
        self.log(f"{__product__} v{__version__} 启动，机器号 {self.client_uid}")

        if not self.cfg.get("complianceAccepted"):
            self.log("合规使用承诺还没勾，去托盘「设置」里勾上再跑。", logging.WARNING)

        # 监控起来
        self.file_monitor = FileMonitor(self.store, dirs=config.watch_dirs(self.cfg))
        self.file_monitor.start()
        self.audio_monitor = AudioMonitor(self.store, on_info=lambda items: self.socket and self.socket.emit("audio_info", {"items": items}))
        self.audio_monitor.start()

        # 保护起来
        if self.cfg.get("protectProcess"):
            guard.start_guardian()
        if self.cfg.get("autostart"):
            guard.enable_autostart()

        threading.Thread(target=self._connect_loop, name="mythclass-connect", daemon=True).start()
        threading.Thread(target=self._upload_loop, name="mythclass-upload", daemon=True).start()
        threading.Thread(target=self._housekeeping_loop, name="mythclass-housekeeping", daemon=True).start()

        self.tray.start()

    def wait_forever(self) -> None:
        while not self._stop.is_set():
            time.sleep(2)

    def shutdown(self) -> None:
        self.log("收工中…")
        self._stop.set()
        self.screen.stop()
        if self.socket:
            self.socket.stop()
        if self.file_monitor:
            self.file_monitor.stop()
        if self.audio_monitor:
            self.audio_monitor.stop()
        self.store.close()
        self.tray.stop()
        time.sleep(0.5)
        sys.exit(0)

    def status(self) -> str:
        return (
            f"{__product__} v{__version__}\n"
            f"机器 ID：{self.client_uid}\n"
            f"服务器：{self.server_url or '（还没连上）'}\n"
            f"状态：{'已连接' if self.connected else '未连接'}\n"
            f"屏幕流：{'推着呢' if self.screen.running else '关着'}\n"
            f"记录：{self.store.stats()}\n"
            f"能用命令：{', '.join(known_commands())}"
        )


def _single_instance() -> bool:
    """同一台机器只跑一个，两个一起推流会打架"""
    if sys.platform != "win32":
        return True
    handle = ctypes.windll.kernel32.CreateMutexW(None, False, "Global\\MythclassClientMutex")
    already = ctypes.windll.kernel32.GetLastError() == 183  # ERROR_ALREADY_EXISTS
    return not already


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])

    logging.basicConfig(
        level=logging.INFO,
        format=LOG_FORMAT,
        filename=str(config.LOG_FILE) if "--console" not in argv else None,
    )

    if "--guard" in argv:
        index = argv.index("--guard")
        pid = int(argv[index + 1]) if len(argv) > index + 1 else 0
        config.ensure_dirs()
        guard.run_guardian(pid)
        return 0

    if "--status" in argv:
        client = MythclassClient(console=True)
        print(client.status())
        return 0

    config.ensure_dirs()

    if not _single_instance():
        print("[Mythclass] 已经有一个在跑了，这个先退。")
        return 0

    client = MythclassClient(console="--console" in argv)
    try:
        client.start()
    except KeyboardInterrupt:
        client.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
