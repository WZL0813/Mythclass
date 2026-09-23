"""机器身份：算一个稳定的 client_uid

取 MAC + 主机名 + 机器 GUID 揉一起，取哈希前 12 位。
稳定、可读、不暴露真实信息。也可以在配置里手动指定。
"""

from __future__ import annotations

import hashlib
import platform
import uuid

PREFIX = "MYTH"


def machine_fingerprint() -> str:
    parts = [
        str(uuid.getnode()),          # MAC
        platform.node(),              # 主机名
        platform.machine(),
    ]
    try:
        # Windows 上的机器 GUID，重装系统前都不变
        import winreg  # type: ignore

        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography",
            0,
            winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
        ) as key:
            parts.append(str(winreg.QueryValueEx(key, "MachineGuid")[0]))
    except Exception:
        pass

    raw = "|".join(parts)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest().upper()
    return f"{PREFIX}-{digest[:4]}-{digest[4:8]}-{digest[8:12]}"


def resolve_uid(cfg: dict) -> str:
    uid = (cfg.get("clientUid") or "").strip().upper()
    return uid or machine_fingerprint()


def os_description() -> str:
    return f"{platform.system()} {platform.release()} ({platform.version()})"
