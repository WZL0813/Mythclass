"""系统托盘

左键单击 → 关于窗口
右键 → 关于 / 设置 / 状态 / 退出登录

退出也要密码，别让学生随手点掉。
"""

from __future__ import annotations

import threading
import tkinter as tk
from tkinter import messagebox

from . import __product__, __version__
from . import config, ui


def make_icon_image(size: int = 64):
    """画一个托盘图标：苔绿底 + 米白 M + 琥珀点"""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return None

    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([1, 1, size - 2, size - 2], radius=size // 5, fill=(47, 79, 62, 255))
    # M
    draw.line(
        [(size * 0.24, size * 0.72), (size * 0.24, size * 0.3), (size * 0.5, size * 0.56), (size * 0.76, size * 0.3), (size * 0.76, size * 0.72)],
        fill=(243, 239, 227, 255),
        width=max(2, size // 12),
        joint="curve",
    )
    # 琥珀点
    r = size * 0.08
    draw.ellipse([size * 0.66 - r, size * 0.74 - r, size * 0.66 + r, size * 0.74 + r], fill=(201, 123, 60, 255))
    return image


class Tray:
    def __init__(self, app):
        self.app = app
        self.icon = None
        self._thread: threading.Thread | None = None

    def _status_text(self) -> str:
        app = self.app
        state = "已连接" if app.connected else "重连中"
        return f"{state} · {app.server_url or '没服务器'}\n机器 ID：{app.client_uid}"

    def _show_status(self) -> None:
        def run():
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            messagebox.showinfo("Mythclass 状态", self._status_text(), parent=root)
            root.destroy()

        threading.Thread(target=run, daemon=True).start()

    def _show_about(self) -> None:
        ui.open_about_async(self.app.cfg, self.app.client_uid, self._show_settings)

    def _show_settings(self) -> None:
        ui.open_settings_async(self.app.cfg, self.app.client_uid, self.app.on_settings_saved)

    def _confirm_exit(self) -> None:
        def run():
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            entered = _ask_password(root, self.app.cfg)
            root.destroy()
            if entered:
                self.app.shutdown()

        threading.Thread(target=run, daemon=True).start()

    def start(self) -> None:
        try:
            import pystray
        except ImportError:
            # 没装 pystray 就纯后台跑，功能不受影响
            self.app.log("没装 pystray，托盘不可用，程序继续在后台跑。")
            self.app.wait_forever()
            return

        from pystray import Menu, MenuItem

        image = make_icon_image()
        menu = Menu(
            MenuItem("关于", lambda: self._show_about(), default=True),
            MenuItem("设置", lambda: self._show_settings()),
            MenuItem("状态", lambda: self._show_status()),
            Menu.SEPARATOR,
            MenuItem("退出（要密码）", lambda: self._confirm_exit()),
        )
        self.icon = pystray.Icon("mythclass", image, __product__, menu)
        self.app.log("托盘起来了。")
        self.icon.run()

    def notify(self, message: str, title: str = "Mythclass") -> None:
        if self.icon:
            try:
                self.icon.notify(message, title)
            except Exception:
                pass

    def stop(self) -> None:
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass


def _ask_password(parent, cfg: dict) -> bool:
    """退出前要一次密码"""
    dialog = tk.Toplevel(parent)
    dialog.title("要密码")
    dialog.attributes("-topmost", True)
    dialog.geometry("320x150")
    tk.Label(dialog, text="输入管理员密码才能退出", font=("Microsoft YaHei", 10)).pack(pady=16)
    entry = tk.Entry(dialog, show="*", width=24)
    entry.pack()
    entry.focus_set()
    result = {"ok": False}

    def confirm(_event=None):
        if entry.get() == str(cfg.get("adminPassword", "admin123")):
            result["ok"] = True
        dialog.destroy()

    entry.bind("<Return>", confirm)
    tk.Button(dialog, text="确定", command=confirm).pack(pady=12)
    parent.wait_window(dialog)
    return result["ok"]
