"""三个监控器：文件改动、音频播放、屏幕画面

每个都是独立线程，坏掉一个不影响别的。
"""

from __future__ import annotations

import base64
import io
import threading
import time
from pathlib import Path
from typing import Callable

from . import config


# ============================== 文件监控 ==============================


class FileMonitor:
    """盯住指定目录，谁动了文件就记一笔"""

    OPERATIONS = {
        "created": "created",
        "modified": "modified",
        "deleted": "deleted",
        "moved": "moved",
    }

    def __init__(self, store, on_log: Callable[[dict], None] | None = None, dirs: list[str] | None = None):
        self.store = store
        self.on_log = on_log or (lambda _e: None)
        self.dirs = dirs or []
        self._observer = None
        self._recent: dict[str, float] = {}
        self._lock = threading.Lock()

    def start(self) -> None:
        try:
            from watchdog.observers import Observer
        except ImportError:
            return

        from watchdog.events import FileSystemEventHandler

        monitor = self

        class Handler(FileSystemEventHandler):
            def on_any_event(self, event):  # noqa: D102
                if event.is_directory:
                    return
                monitor._record(event.event_type, event.src_path, getattr(event, "dest_path", None))

        self._observer = Observer()
        scheduled = 0
        for folder in self.dirs:
            try:
                self._observer.schedule(Handler(), folder, recursive=True)
                scheduled += 1
            except (OSError, ValueError):
                continue
        if scheduled == 0:
            # 一个目录都没挂上，别空转一个线程
            self._observer = None
            return
        self._observer.daemon = True
        self._observer.start()

    def _record(self, event_type: str, src: str, dest: str | None) -> None:
        key = f"{event_type}:{src}"
        now = time.time()
        with self._lock:
            # 同一文件 2 秒内的重复事件算一次
            if now - self._recent.get(key, 0) < 2:
                return
            self._recent[key] = now
            if len(self._recent) > 4000:
                cutoff = now - 60
                self._recent = {k: v for k, v in self._recent.items() if v > cutoff}

        path = src
        operation = self.OPERATIONS.get(event_type, event_type)
        if event_type == "moved" and dest:
            path = f"{src} → {dest}"
            operation = "renamed" if Path(src).parent == Path(dest).parent else "moved"

        size = 0
        try:
            if Path(src).exists():
                size = Path(src).stat().st_size
        except OSError:
            size = 0

        self.store.add_file_log(operation, path, size)
        self.on_log({"timestamp": time.strftime("%Y-%m-%d %H:%M:%S"), "operation": operation, "file_path": path, "file_size": size})

    def stop(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=3)
            self._observer = None


# ============================== 音频监控 ==============================


class AudioMonitor:
    """每 5 秒扫一遍 Windows 音频会话，谁出声就上报"""

    def __init__(self, store, on_info: Callable[[list[dict]], None] | None = None, interval: int = 5):
        self.store = store
        self.on_info = on_info or (lambda _i: None)
        self.interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_signature = ""
        self.available = True
        self.last_error = ""

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="mythclass-audio", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                items = self._sample()
                signature = "|".join(f"{i['processName']}:{i['volume']}:{i['state']}" for i in items)
                if signature != self._last_signature:
                    self._last_signature = signature
                    for item in items:
                        self.store.add_audio_log(item["processName"], item["title"], item["volume"], item["state"])
                    if items:
                        self.on_info(items)
            except Exception as err:  # 音频这块最容易炸，炸了就安静
                self.available = False
                self.last_error = str(err)
            self._stop.wait(self.interval)

    def _sample(self) -> list[dict]:
        """用 pycaw 读会话。没装就返回空。"""
        try:
            from pycaw.pycaw import AudioUtilities
        except ImportError:
            self.available = False
            self.last_error = "pycaw 没装，音频检测关着"
            return []

        sessions = AudioUtilities.GetAllSessions()
        items = []
        for session in sessions:
            try:
                volume = session.SimpleAudioVolume
                if volume is None:
                    continue
                level = int(round(volume.GetMasterVolume() * 100))
                muted = bool(volume.GetMute())
                process = session.Process
                name = process.name() if process else "系统声音"
                state = "muted" if muted else "playing"
                # 音量 0 且没静音，多半是没在响
                if level == 0 and not muted:
                    state = "idle"
                if state == "idle":
                    continue
                items.append(
                    {
                        "processName": name,
                        "title": self._window_title(session),
                        "volume": level,
                        "state": state,
                    }
                )
            except Exception:
                continue
        return items

    @staticmethod
    def _window_title(session) -> str:
        try:
            from pycaw.pycaw import AudioUtilities

            return AudioUtilities.GetWindowTitleForSession(session) or ""
        except Exception:
            return ""


# ============================== 屏幕捕获 ==============================


class ScreenStreamer:
    """只有在老师要看的时候才开。没人看就别耗 CPU。"""

    def __init__(self, fps: int = 12, quality: int = 60):
        self.fps = max(1, min(int(fps or 12), 30))
        self.quality = max(20, min(int(quality or 60), 95))
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.running = False
        self.frames_sent = 0

    def start(self, on_frame: Callable[[dict], None]) -> None:
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, args=(on_frame,), name="mythclass-screen", daemon=True)
        self._thread.start()
        self.running = True

    def stop(self) -> None:
        self._stop.set()
        self.running = False

    def _loop(self, on_frame: Callable[[dict], None]) -> None:
        try:
            import mss
            from PIL import Image
        except ImportError:
            self.running = False
            return

        interval = 1.0 / self.fps
        with mss.mss() as grabber:
            monitor = grabber.monitors[1] if len(grabber.monitors) > 1 else grabber.monitors[0]
            while not self._stop.is_set():
                started = time.time()
                try:
                    shot = grabber.grab(monitor)
                    image = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
                    # 太宽就先缩一下，带宽有限
                    if image.width > 1600:
                        ratio = 1600 / image.width
                        image = image.resize((1600, int(image.height * ratio)))
                    buffer = io.BytesIO()
                    image.save(buffer, format="JPEG", quality=self.quality)
                    payload = {
                        "data": "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
                        "width": image.width,
                        "height": image.height,
                        "ts": int(time.time() * 1000),
                    }
                    on_frame(payload)
                    self.frames_sent += 1
                except Exception:
                    time.sleep(0.5)
                elapsed = time.time() - started
                self._stop.wait(max(interval - elapsed, 0.01))
        self.running = False


def default_watch_dirs(cfg: dict) -> list[str]:
    return config.watch_dirs(cfg)
