"""命令执行：老师发什么，这儿就干什么

每个命令返回 (是否成功, 说明)。屏幕相关的不在这儿，由 runtime 直接开关流。
"""

from __future__ import annotations

import ctypes
import os
import subprocess
import sys
import tempfile
import tkinter as tk
import urllib.request
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000


def _hidden(cmd, **kwargs):
    """起个不弹黑框的子进程"""
    kwargs.setdefault("creationflags", CREATE_NO_WINDOW)
    kwargs.setdefault("shell", isinstance(cmd, str))
    kwargs.setdefault("stdout", subprocess.PIPE)
    kwargs.setdefault("stderr", subprocess.STDOUT)
    return subprocess.run(cmd, **kwargs)


def _run(cmd) -> tuple[bool, str]:
    try:
        result = _hidden(cmd)
        output = (result.stdout or b"").decode("utf-8", "ignore").strip()
        return result.returncode == 0, output or f"退出码 {result.returncode}"
    except Exception as err:
        return False, str(err)


# ============================== 各种命令 ==============================


def cmd_lock(args: dict) -> tuple[bool, str]:
    try:
        ctypes.windll.user32.LockWorkStation()
        return True, "已锁屏"
    except Exception as err:
        return False, str(err)


def cmd_unlock(args: dict) -> tuple[bool, str]:
    # Windows 不允许程序替谁解锁，这是系统边界
    return True, "解锁需要人在机器前输入密码，这边只能提示到这"


def cmd_shutdown(args: dict) -> tuple[bool, str]:
    return _run("shutdown /s /t 5 /c \"Mythclass：老师要求关机\"")


def cmd_reboot(args: dict) -> tuple[bool, str]:
    return _run("shutdown /r /t 5 /c \"Mythclass：老师要求重启\"")


def cmd_logout(args: dict) -> tuple[bool, str]:
    return _run("shutdown /l")


def cmd_message(args: dict) -> tuple[bool, str]:
    text = str(args.get("text") or "").strip() or "老师有话要说"
    title = str(args.get("title") or "Mythclass 通知")

    def show():
        root = tk.Tk()
        root.title(title)
        root.attributes("-topmost", True)
        root.configure(bg="#f3efe3")
        root.geometry("460x200+%d+%d" % (max(root.winfo_screenwidth() // 2 - 230, 0), max(root.winfo_screenheight() // 3, 0)))
        frame = tk.Frame(root, bg="#f3efe3", padx=26, pady=22)
        frame.pack(fill="both", expand=True)
        tk.Label(frame, text=title, bg="#f3efe3", fg="#2f4f3e", font=("Microsoft YaHei", 14, "bold")).pack(anchor="w")
        tk.Message(frame, text=text, bg="#f3efe3", fg="#10160f", width=390, font=("Microsoft YaHei", 12)).pack(anchor="w", pady=(12, 16))
        tk.Button(frame, text="知道了", command=root.destroy, bg="#2f4f3e", fg="#f3efe3", relief="flat", padx=18, pady=4).pack(anchor="e")
        root.after(60000, root.destroy)  # 一分钟没人点就自己关
        root.mainloop()

    import threading

    threading.Thread(target=show, name="mythclass-message", daemon=True).start()
    return True, "弹窗已经推过去了"


def cmd_open_url(args: dict) -> tuple[bool, str]:
    url = str(args.get("url") or "").strip()
    if not url:
        return False, "没给网址"
    try:
        os.startfile(url)  # noqa: S606
        return True, f"打开了 {url}"
    except OSError:
        return _run(["cmd", "/c", "start", "", url])


def cmd_open_app(args: dict) -> tuple[bool, str]:
    path = str(args.get("path") or "").strip()
    if not path:
        return False, "没给路径"
    try:
        subprocess.Popen(path, creationflags=CREATE_NO_WINDOW, shell=True)
        return True, f"起了 {path}"
    except Exception as err:
        return False, str(err)


def cmd_file_distribute(args: dict) -> tuple[bool, str]:
    """从老师给的地址下个文件，落到指定位置"""
    url = str(args.get("url") or "").strip()
    target = str(args.get("path") or "").strip()
    if not url:
        return False, "没给下载地址"
    if not target:
        target = str(Path(tempfile.gettempdir()) / (url.split("/")[-1] or "mythclass-file"))
    try:
        Path(target).parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, target)
        return True, f"已保存到 {target}"
    except Exception as err:
        return False, str(err)


def cmd_screen_broadcast(args: dict) -> tuple[bool, str]:
    """全屏开个网页，当广播用"""
    url = str(args.get("url") or "").strip()
    if not url:
        return False, "没给广播地址"

    def show():
        root = tk.Tk()
        root.attributes("-fullscreen", True)
        root.configure(bg="#10160f")
        label = tk.Label(root, text="屏幕广播中\n按 Esc 退出", bg="#10160f", fg="#f3efe3", font=("Microsoft YaHei", 26))
        label.pack(expand=True)
        tk.Button(root, text="打开广播内容", command=lambda: os.startfile(url)).pack(pady=10)
        root.bind("<Escape>", lambda _e: root.destroy())
        root.mainloop()

    import threading

    threading.Thread(target=show, name="mythclass-broadcast", daemon=True).start()
    return True, "广播已经开起来"


def cmd_net_ban(args: dict) -> tuple[bool, str]:
    """用防火墙规则掐网。要管理员权限。"""
    enable = str(args.get("enable", "true")).lower() in ("1", "true", "yes", "on")
    rule = "Mythclass-NetBan"
    if enable:
        ok, out = _run(f'netsh advfirewall firewall add rule name="{rule}" dir=out action=block enable=yes')
        return ok, out or "网络已经掐了"
    ok, out = _run(f'netsh advfirewall firewall delete rule name="{rule}"')
    return ok, out or "网络放开了"


REGISTRY = {
    "lock": cmd_lock,
    "unlock": cmd_unlock,
    "shutdown": cmd_shutdown,
    "reboot": cmd_reboot,
    "logout": cmd_logout,
    "message": cmd_message,
    "open_url": cmd_open_url,
    "open_app": cmd_open_app,
    "file_distribute": cmd_file_distribute,
    "screen_broadcast": cmd_screen_broadcast,
    "net_ban": cmd_net_ban,
}


def execute(command: str, args: dict | None = None) -> tuple[bool, str]:
    handler = REGISTRY.get(command)
    if not handler:
        return False, f"不认识这个命令：{command}"
    try:
        return handler(args or {})
    except Exception as err:
        return False, f"{type(err).__name__}: {err}"


def known_commands() -> list[str]:
    return sorted(REGISTRY.keys()) + ["screen_start", "screen_stop"]


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


if sys.platform != "win32":  # 开发机上跑得动，别炸
    def _noop(_args):  # type: ignore
        return False, "这个命令只在 Windows 上有用"

    for _name in list(REGISTRY):
        REGISTRY[_name] = _noop
