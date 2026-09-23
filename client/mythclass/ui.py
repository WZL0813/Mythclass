"""两个小窗口：关于、设置

设置要密码。默认 admin123，第一次进去会催你改掉。
"""

from __future__ import annotations

import threading
import tkinter as tk
from tkinter import messagebox, ttk

from . import __author__, __product__, __version__, config, guard, identity

REPO = "https://github.com/WZL0813/Mythclass"

BG = "#f3efe3"
INK = "#10160f"
MOSS = "#2f4f3e"
AMBER = "#c97b3c"


def _center(window: tk.Tk, width: int, height: int) -> None:
    window.update_idletasks()
    x = (window.winfo_screenwidth() - width) // 2
    y = (window.winfo_screenheight() - height) // 3
    window.geometry(f"{width}x{height}+{x}+{y}")


# ================================ 关于 ================================


class AboutWindow:
    def __init__(self, cfg: dict, client_uid: str, on_settings):
        self.cfg = cfg
        self.client_uid = client_uid
        self.on_settings = on_settings
        self.root = tk.Tk()
        self.root.title("关于 Mythclass")
        self.root.configure(bg=BG)
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)
        _center(self.root, 460, 330)
        self._build()

    def _build(self) -> None:
        pad = tk.Frame(self.root, bg=BG, padx=26, pady=22)
        pad.pack(fill="both", expand=True)

        tk.Label(pad, text=__product__, bg=BG, fg=MOSS, font=("Microsoft YaHei", 14, "bold"), wraplength=400, justify="left").pack(anchor="w")
        tk.Label(pad, text=f"v{__version__} / by {__author__}", bg=BG, fg=INK, font=("Microsoft YaHei", 10)).pack(anchor="w", pady=(4, 14))

        info = tk.Frame(pad, bg=BG)
        info.pack(fill="x")
        rows = [
            ("机器 ID", self.client_uid),
            ("机器名", self.cfg.get("clientName") or "未命名"),
            ("当前服务器", self._current_server()),
        ]
        for i, (key, value) in enumerate(rows):
            tk.Label(info, text=key, bg=BG, fg=MOSS, font=("Microsoft YaHei", 10), width=10, anchor="w").grid(row=i, column=0, sticky="w", pady=2)
            tk.Label(info, text=value, bg=BG, fg=INK, font=("Consolas", 10), anchor="w", wraplength=280, justify="left").grid(row=i, column=1, sticky="w", pady=2)

        link = tk.Label(pad, text=REPO, bg=BG, fg=AMBER, font=("Consolas", 10), cursor="hand2")
        link.pack(anchor="w", pady=(14, 0))
        link.bind("<Button-1>", lambda _e: self._open_repo())

        btns = tk.Frame(pad, bg=BG)
        btns.pack(fill="x", pady=(18, 0))
        self._button(btns, "复制仓库地址", self._copy_repo).pack(side="left")
        self._button(btns, "设置", lambda: self._open_settings()).pack(side="left", padx=8)
        self._button(btns, "关闭", self.root.destroy).pack(side="right")

    def _button(self, parent, text, command):
        return tk.Button(
            parent, text=text, command=command, bg=MOSS, fg=BG, relief="flat",
            activebackground="#3f6b52", activeforeground=BG, padx=14, pady=5,
            font=("Microsoft YaHei", 10), cursor="hand2",
        )

    def _current_server(self) -> str:
        servers = config.enabled_servers(self.cfg)
        return servers[0] if servers else "（没配）"

    def _copy_repo(self) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(REPO)
        messagebox.showinfo("好了", "仓库地址已经放剪贴板里了。", parent=self.root)

    def _open_repo(self) -> None:
        import webbrowser

        webbrowser.open(REPO)

    def _open_settings(self) -> None:
        self.root.destroy()
        self.on_settings()

    def show(self) -> None:
        self.root.mainloop()


# ================================ 设置 ================================


class SettingsWindow:
    def __init__(self, cfg: dict, client_uid: str, on_save):
        self.cfg = dict(cfg)
        self.client_uid = client_uid
        self.on_save = on_save
        self.root = tk.Tk()
        self.root.title("Mythclass 设置")
        self.root.configure(bg=BG)
        self.root.attributes("-topmost", True)
        _center(self.root, 620, 640)
        self.vars: dict[str, tk.Variable] = {}

        if not self._ask_password():
            self.root.destroy()
            self.authorized = False
            return
        self.authorized = True
        self._build()

    # ------------------------------ 密码门 ------------------------------

    def _ask_password(self) -> bool:
        dialog = tk.Toplevel(self.root)
        dialog.title("要密码")
        dialog.configure(bg=BG)
        dialog.attributes("-topmost", True)
        dialog.resizable(False, False)
        _center(dialog, 340, 190)

        tk.Label(dialog, text="管理员密码", bg=BG, fg=MOSS, font=("Microsoft YaHei", 11, "bold")).pack(pady=(22, 6))
        entry = tk.Entry(dialog, show="*", width=26, font=("Consolas", 11))
        entry.pack()
        entry.focus_set()

        result = {"ok": False, "password": ""}

        def confirm(_event=None):
            entered = entry.get()
            if entered == str(self.cfg.get("adminPassword", "admin123")):
                result["ok"] = True
                result["password"] = entered
                dialog.destroy()
            else:
                messagebox.showerror("不对", "密码错了。", parent=dialog)
                entry.delete(0, tk.END)

        entry.bind("<Return>", confirm)
        tk.Button(dialog, text="进去", command=confirm, bg=MOSS, fg=BG, relief="flat", padx=18, pady=4, cursor="hand2").pack(pady=14)
        dialog.grab_set()
        self.root.wait_window(dialog)
        return result["ok"]

    # ------------------------------- 界面 -------------------------------

    def _build(self) -> None:
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill="both", expand=True, padx=14, pady=12)
        notebook.add(self._tab_basic(notebook), text="基本")
        notebook.add(self._tab_servers(notebook), text="服务器")
        notebook.add(self._tab_monitor(notebook), text="监控与记录")
        notebook.add(self._tab_protect(notebook), text="保护")

        bar = tk.Frame(self.root, bg=BG)
        bar.pack(fill="x", padx=14, pady=(0, 14))
        tk.Button(bar, text="保存", command=self._save, bg=MOSS, fg=BG, relief="flat", padx=20, pady=6, cursor="hand2").pack(side="right")
        tk.Button(bar, text="取消", command=self.root.destroy, bg="#d8d2c2", fg=INK, relief="flat", padx=16, pady=6, cursor="hand2").pack(side="right", padx=8)

    def _tab_basic(self, parent) -> tk.Frame:
        frame = tk.Frame(parent, bg=BG, padx=18, pady=16)
        v = self.vars

        tk.Label(frame, text="机器名", bg=BG, fg=MOSS).grid(row=0, column=0, sticky="w", pady=6)
        v["clientName"] = tk.StringVar(value=self.cfg.get("clientName", ""))
        tk.Entry(frame, textvariable=v["clientName"], width=36).grid(row=0, column=1, sticky="w")

        tk.Label(frame, text="机器 ID", bg=BG, fg=MOSS).grid(row=1, column=0, sticky="w", pady=6)
        tk.Label(frame, text=self.client_uid, bg=BG, fg=INK, font=("Consolas", 10)).grid(row=1, column=1, sticky="w")

        tk.Label(frame, text="管理员密码", bg=BG, fg=MOSS).grid(row=2, column=0, sticky="w", pady=6)
        v["adminPassword"] = tk.StringVar(value=self.cfg.get("adminPassword", "admin123"))
        tk.Entry(frame, textvariable=v["adminPassword"], width=36, show="*").grid(row=2, column=1, sticky="w")

        if self.cfg.get("requirePasswordChange") and self.cfg.get("adminPassword") == "admin123":
            tk.Label(frame, text="默认密码还是 admin123，改掉它。", bg=BG, fg=AMBER, font=("Microsoft YaHei", 9)).grid(row=3, column=1, sticky="w")

        v["complianceAccepted"] = tk.BooleanVar(value=bool(self.cfg.get("complianceAccepted")))
        tk.Checkbutton(
            frame, variable=v["complianceAccepted"], bg=BG, fg=INK, activebackground=BG, wraplength=420, justify="left",
            text="我知道这套软件会看屏幕、记文件，只用在合法教学管理上，并已告知学生、取得学校同意。",
        ).grid(row=4, column=0, columnspan=2, sticky="w", pady=(14, 4))
        return frame

    def _tab_servers(self, parent) -> tk.Frame:
        frame = tk.Frame(parent, bg=BG, padx=18, pady=16)

        tk.Label(frame, text="连接顺序：官方优先，然后按下面顺序试。官方删不掉。", bg=BG, fg=MOSS, wraplength=520, justify="left").pack(anchor="w")

        self.server_list = tk.Listbox(frame, height=6, font=("Consolas", 10))
        self.server_list.pack(fill="x", pady=10)
        self._refresh_servers()

        add = tk.Frame(frame, bg=BG)
        add.pack(fill="x")
        tk.Label(add, text="名称", bg=BG, fg=MOSS).grid(row=0, column=0, sticky="w")
        self.vars["newName"] = tk.StringVar()
        tk.Entry(add, textvariable=self.vars["newName"], width=16).grid(row=0, column=1, padx=6)
        tk.Label(add, text="地址", bg=BG, fg=MOSS).grid(row=0, column=2, sticky="w")
        self.vars["newUrl"] = tk.StringVar()
        tk.Entry(add, textvariable=self.vars["newUrl"], width=28).grid(row=0, column=3, padx=6)
        tk.Button(add, text="加上", command=self._add_server, bg=MOSS, fg=BG, relief="flat", padx=12, cursor="hand2").grid(row=0, column=4)
        tk.Button(add, text="删掉选中的", command=self._remove_server, bg="#d8d2c2", fg=INK, relief="flat", padx=12, cursor="hand2").grid(row=1, column=4, pady=8)
        return frame

    def _refresh_servers(self) -> None:
        self.server_list.delete(0, tk.END)
        for s in self.cfg.get("servers", []):
            tag = "官方" if s.get("official") else ("启用" if s.get("enabled", True) else "停用")
            self.server_list.insert(tk.END, f"[{tag}] {s.get('name', '')} · {s.get('url', '')}")

    def _add_server(self) -> None:
        url = self.vars["newUrl"].get().strip()
        if not url:
            return messagebox.showwarning("缺东西", "地址得填。", parent=self.root)
        if not url.startswith(("ws://", "wss://")):
            url = "wss://" + url
        self.cfg.setdefault("servers", []).append(
            {"name": self.vars["newName"].get().strip() or url, "url": url, "remark": "", "enabled": True, "official": False}
        )
        self.vars["newName"].set("")
        self.vars["newUrl"].set("")
        self._refresh_servers()

    def _remove_server(self) -> None:
        picked = self.server_list.curselection()
        if not picked:
            return
        index = picked[0]
        servers = self.cfg.get("servers", [])
        if 0 <= index < len(servers):
            if servers[index].get("official"):
                return messagebox.showerror("不行", "官方服务器不能删。", parent=self.root)
            servers.pop(index)
            self._refresh_servers()

    def _tab_monitor(self, parent) -> tk.Frame:
        frame = tk.Frame(parent, bg=BG, padx=18, pady=16)
        v = self.vars

        tk.Label(frame, text="监控目录（一行一个）", bg=BG, fg=MOSS).pack(anchor="w")
        self.watch_text = tk.Text(frame, height=7, font=("Consolas", 10))
        self.watch_text.pack(fill="x", pady=8)
        self.watch_text.insert("1.0", "\n".join(self.cfg.get("watchDirs", [])))

        row = tk.Frame(frame, bg=BG)
        row.pack(fill="x", pady=6)
        tk.Label(row, text="最多留多少条", bg=BG, fg=MOSS).grid(row=0, column=0, sticky="w")
        v["maxLogCount"] = tk.StringVar(value=str(self.cfg.get("maxLogCount", 5000)))
        tk.Entry(row, textvariable=v["maxLogCount"], width=12).grid(row=0, column=1, padx=8)
        tk.Label(row, text="最多占多少 MB", bg=BG, fg=MOSS).grid(row=0, column=2, sticky="w")
        v["maxLogSizeMB"] = tk.StringVar(value=str(int(self.cfg.get("maxLogSize", 209715200)) // 1024 // 1024))
        tk.Entry(row, textvariable=v["maxLogSizeMB"], width=12).grid(row=0, column=3, padx=8)

        tk.Label(frame, text="超了就删最旧的，不会把硬盘塞满。", bg=BG, fg=INK).pack(anchor="w", pady=(8, 0))
        return frame

    def _tab_protect(self, parent) -> tk.Frame:
        frame = tk.Frame(parent, bg=BG, padx=18, pady=16)
        v = self.vars

        for key, text in (
            ("protectProcess", "进程保护（被关掉会自动回来）"),
            ("disableTaskManager", "禁用任务管理器"),
            ("autostart", "开机自启"),
        ):
            v[key] = tk.BooleanVar(value=bool(self.cfg.get(key)))
            tk.Checkbutton(frame, text=text, variable=v[key], bg=BG, fg=INK, activebackground=BG, anchor="w").pack(anchor="w", pady=4)

        tk.Label(
            frame,
            text="禁用任务管理器要注销一次才彻底生效。\n自启会同时写 Run 键和一条登录计划任务。",
            bg=BG, fg=MOSS, justify="left", font=("Microsoft YaHei", 9),
        ).pack(anchor="w", pady=(14, 0))
        return frame

    # ------------------------------- 保存 -------------------------------

    def _save(self) -> None:
        cfg = dict(self.cfg)
        cfg["clientName"] = self.vars["clientName"].get().strip() or "教室一体机"
        cfg["adminPassword"] = self.vars["adminPassword"].get() or "admin123"
        cfg["requirePasswordChange"] = cfg["adminPassword"] == "admin123"
        cfg["complianceAccepted"] = bool(self.vars["complianceAccepted"].get())
        cfg["watchDirs"] = [line.strip() for line in self.watch_text.get("1.0", tk.END).splitlines() if line.strip()]

        try:
            cfg["maxLogCount"] = max(100, int(float(self.vars["maxLogCount"].get())))
        except ValueError:
            cfg["maxLogCount"] = 5000
        try:
            cfg["maxLogSize"] = max(1, int(float(self.vars["maxLogSizeMB"].get()))) * 1024 * 1024
        except ValueError:
            cfg["maxLogSize"] = 209715200

        cfg["protectProcess"] = bool(self.vars["protectProcess"].get())
        cfg["disableTaskManager"] = bool(self.vars["disableTaskManager"].get())
        cfg["autostart"] = bool(self.vars["autostart"].get())

        # 保护开关顺手落地
        guard.set_task_manager_disabled(cfg["disableTaskManager"])
        if cfg["autostart"]:
            guard.enable_autostart()
        else:
            guard.disable_autostart()

        saved = config.save(cfg)
        self.on_save(saved)
        messagebox.showinfo("好了", "设置存下来了。", parent=self.root)
        self.root.destroy()

    def show(self) -> None:
        self.root.mainloop()


def open_about_async(cfg: dict, client_uid: str, on_settings) -> None:
    """托盘是主线程，窗口得另开一个线程跑 tkinter"""
    def run():
        AboutWindow(cfg, client_uid, on_settings).show()

    threading.Thread(target=run, name="mythclass-about", daemon=True).start()


def open_settings_async(cfg: dict, client_uid: str, on_save) -> None:
    def run():
        window = SettingsWindow(cfg, client_uid, on_save)
        if getattr(window, "authorized", False):
            window.show()

    threading.Thread(target=run, name="mythclass-settings", daemon=True).start()
