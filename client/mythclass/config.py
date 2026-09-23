"""客户端配置：读写 %APPDATA%\\Mythclass\\config.json

第一次运行会把 config.example.json 复制过去。之后所有改动都落在那份。
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

APP_DIR = Path(os.environ.get("APPDATA", Path.home())) / "Mythclass"
CONFIG_FILE = APP_DIR / "config.json"
DB_FILE = APP_DIR / "records.db"
LOG_FILE = APP_DIR / "client.log"

OFFICIAL_SERVER = "wss://mythclassapi.ryokuryuneko.top"

DEFAULTS = {
    "clientUid": "",
    "clientName": "教室一体机",
    "servers": [
        {
            "name": "官方服务器（不可删除）",
            "url": OFFICIAL_SERVER,
            "remark": "内置，永远保留",
            "enabled": True,
            "official": True,
        }
    ],
    "adminPassword": "admin123",
    "requirePasswordChange": True,
    "protectProcess": True,
    "disableTaskManager": True,
    "autostart": True,
    "complianceAccepted": False,
    "teacherIp": "",
    "watchDirs": [],
    "maxLogCount": 5000,
    "maxLogSize": 209715200,
    "screenFps": 12,
    "screenQuality": 60,
}


def ensure_dirs() -> None:
    APP_DIR.mkdir(parents=True, exist_ok=True)


def _merge_defaults(data: dict) -> dict:
    merged = dict(DEFAULTS)
    merged.update(data or {})
    # 官方服务器永远在，且永远启用
    servers = [s for s in merged.get("servers", []) if isinstance(s, dict)]
    has_official = any(s.get("official") or s.get("url") == OFFICIAL_SERVER for s in servers)
    if not has_official:
        servers.insert(0, dict(DEFAULTS["servers"][0]))
    for s in servers:
        if s.get("official") or s.get("url") == OFFICIAL_SERVER:
            s["official"] = True
            s["enabled"] = True
            s.setdefault("name", "官方服务器（不可删除）")
    merged["servers"] = servers
    return merged


def load() -> dict:
    ensure_dirs()
    if not CONFIG_FILE.exists():
        example = Path(__file__).resolve().parent.parent / "config.example.json"
        if example.exists():
            shutil.copyfile(example, CONFIG_FILE)
        else:
            CONFIG_FILE.write_text(json.dumps(DEFAULTS, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        data = {}
    return _merge_defaults(data)


def save(cfg: dict) -> dict:
    ensure_dirs()
    data = _merge_defaults(cfg)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def enabled_servers(cfg: dict) -> list[str]:
    """按顺序给出要试的服务器地址：官方优先，然后自定义。"""
    order = []
    for s in cfg.get("servers", []):
        if not s.get("enabled", True):
            continue
        url = (s.get("url") or "").strip()
        if url and url not in order:
            order.append(url)
    return order


def watch_dirs(cfg: dict) -> list[str]:
    dirs = [d for d in cfg.get("watchDirs", []) if d]
    if not dirs:
        home = Path.home()
        dirs = [str(home / "Desktop"), str(home / "Documents")]
    return [d for d in dirs if Path(d).exists()]
