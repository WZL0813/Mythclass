"""自启、进程保护、限制任务管理器

这块是「学生不好关掉」的那部分。默认全开，设置里能关。
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
POLICY_KEY = r"Software\Microsoft\Windows\CurrentVersion\Policies\System"
APP_NAME = "Mythclass"
TASK_NAME = "MythclassClient"
GUARD_TASK = "MythclassGuard"

CREATE_NO_WINDOW = 0x08000000


def _pythonw() -> str:
    """优先用 pythonw，省得黑框一闪"""
    exe = sys.executable or "python.exe"
    candidate = exe.replace("python.exe", "pythonw.exe")
    return candidate if os.path.exists(candidate) else exe


def _launch_command() -> str:
    """发布版是 exe，开发态是 python -m mythclass"""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    return f'"{_pythonw()}" -m mythclass'


# ============================== 开机自启 ==============================


def enable_autostart() -> tuple[bool, str]:
    """两个都试：当前用户 Run 键（稳），以及计划任务 SYSTEM 权限（狠）"""
    messages = []
    try:
        import winreg

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, _launch_command())
        messages.append("已加入当前用户自启")
    except Exception as err:
        messages.append(f"Run 键失败：{err}")

    try:
        subprocess.run(
            [
                "schtasks", "/Create", "/TN", TASK_NAME, "/TR", _launch_command(),
                "/SC", "ONLOGON", "/RL", "HIGHEST", "/F",
            ],
            creationflags=CREATE_NO_WINDOW,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        messages.append("已建登录计划任务（最高权限）")
    except Exception as err:
        messages.append(f"计划任务失败：{err}")

    return True, "；".join(messages)


def disable_autostart() -> tuple[bool, str]:
    messages = []
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, APP_NAME)
        messages.append("已移除 Run 键")
    except FileNotFoundError:
        pass
    except Exception as err:
        messages.append(f"Run 键：{err}")

    for task in (TASK_NAME, GUARD_TASK):
        try:
            subprocess.run(
                ["schtasks", "/Delete", "/TN", task, "/F"],
                creationflags=CREATE_NO_WINDOW,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
        except Exception:
            pass
    messages.append("已清理计划任务")
    return True, "；".join(messages)


def autostart_enabled() -> bool:
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ) as key:
            winreg.QueryValueEx(key, APP_NAME)
        return True
    except Exception:
        return False


# ============================== 任务管理器 ==============================


def set_task_manager_disabled(disabled: bool) -> tuple[bool, str]:
    """写注册表策略。对当前用户生效，改完要注销或重启资源管理器才彻底。"""
    try:
        import winreg

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, POLICY_KEY) as key:
            winreg.SetValueEx(key, "DisableTaskMgr", 0, winreg.REG_DWORD, 1 if disabled else 0)
        return True, "任务管理器已禁用" if disabled else "任务管理器放开了"
    except Exception as err:
        return False, str(err)


def task_manager_disabled() -> bool:
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, POLICY_KEY, 0, winreg.KEY_READ) as key:
            return bool(winreg.QueryValueEx(key, "DisableTaskMgr")[0])
    except Exception:
        return False


# ============================== 守护进程 ==============================


def start_guardian() -> bool:
    """起一个跟班进程，盯着主进程，主进程没了就把它拉回来"""
    if getattr(sys, "frozen", False):
        cmd = [sys.executable, "--guard", str(os.getpid())]
    else:
        cmd = [_pythonw(), "-m", "mythclass", "--guard", str(os.getpid())]
    try:
        subprocess.Popen(cmd, creationflags=CREATE_NO_WINDOW, close_fds=True)
        return True
    except Exception:
        return False


def run_guardian(parent_pid: int) -> None:
    """跟班进程的主体：父进程死了就重启它"""
    import ctypes

    kernel32 = ctypes.windll.kernel32
    SYNC = 0x00100000
    PROCESS_QUERY_LIMITED = 0x1000

    def alive(pid: int) -> bool:
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel32.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE

    while True:
        time.sleep(4)
        if not alive(parent_pid):
            # 主进程没了，把它喊回来
            if getattr(sys, "frozen", False):
                subprocess.Popen([sys.executable], creationflags=CREATE_NO_WINDOW)
            else:
                subprocess.Popen([_pythonw(), "-m", "mythclass"], creationflags=CREATE_NO_WINDOW)
            time.sleep(6)
