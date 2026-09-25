"""本地网页冒烟测试

验三件事：
  1. 页面能开、能读到机器名与绑定老师
  2. 没被信任的 IP 拿不到画面、下不了命令
  3. 两条放行路径都对：
     · 同一个 IP 直连满 3 次 → 免密钥（主人定的规则）
     · 任意一张有效配对密钥 → 换台电脑也能用（密钥跨 IP 通用）
"""

import io
import os
import sys
import tempfile
import time
from pathlib import Path

import requests

WORK = Path(__file__).resolve().parents[2] if (Path(__file__).resolve().parents[2] / "Mythclass-Client").exists() \
    else Path(r"D:\Code\DeepSeek\deepseek\deepseek-ai\deepseek-harness\work")
CLIENT = WORK / "Mythclass-Client"
os.environ["APPDATA"] = tempfile.mkdtemp(prefix="mythclass-web-")
sys.path.insert(0, str(CLIENT))

from mythclass import bindings, lanweb, trust  # noqa: E402

passed = failed = 0


def check(name, ok, extra=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name} {extra}")


# 先只信任「别的机器」：本机回环还没被信任，这样才能测「不给进」
trust._save({})
trust.record("192.168.31.111", "王老师")
trust.record("192.168.31.111", "王老师")
KEY = trust.record("192.168.31.111", "王老师")["key"]

bindings.save({"client": {"name": "高一(3)班一体机"}, "teachers": [{"id": 1, "username": "王老师"}]})

ran = []


def on_command(command, args):
    ran.append((command, args))
    return True, f"假装执行了 {command}"


def on_frame():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 40), (30, 60, 45)).save(buf, format="JPEG", quality=70)
    return buf.getvalue()


port = 26995
web = lanweb.LanWeb(
    trust=trust,
    on_command=on_command,
    on_info=lambda: {"name": "高一(3)班一体机", "version": "test", "teachers": [{"username": "王老师"}]},
    on_frame=on_frame,
    log=lambda m: None,
    port=port,
)
check("本地网页起来了", web.start() is True)
check("状态可读", "开着" in web.status(), web.status())
time.sleep(0.4)
BASE = f"http://127.0.0.1:{port}"

print("\n--- 页面与信息 ---")
page = requests.get(BASE + "/", timeout=10)
check("首页能打开", page.status_code == 200, str(page.status_code))
check("页面是中文 HTML", "局域网直连" in page.text and 'charset="utf-8"' in page.text, "")
check("页面带密钥输入框", "配对密钥" in page.text, "")
info = requests.get(BASE + "/api/info", timeout=10).json()
check("info 带机器名", info.get("name") == "高一(3)班一体机", str(info))
check("info 带绑定老师", bool(info.get("teachers")) and info["teachers"][0]["username"] == "王老师", str(info.get("teachers")))
check("本机还没被信任 → trusted=False", info.get("trusted") is False, str(info.get("trusted")))

print("\n--- 没被信任时该拦的都要拦住 ---")
check("错密钥 → 401", requests.post(BASE + "/api/auth", json={"key": "0" * 32}, timeout=10).status_code == 401)
check("没密钥拿不到画面 → 401", requests.get(BASE + "/frame", timeout=10).status_code == 401)
check("没密钥下不了命令 → 401", requests.post(BASE + "/api/command", json={"command": "lock"}, timeout=10).status_code == 401)

print("\n--- 路 1：贴密钥（跨 IP 通用）---")
good = requests.post(BASE + "/api/auth", json={"key": KEY}, timeout=10)
check("贴对的密钥 → 200", good.status_code == 200, good.text[:120])
check("发了 Cookie", "mythkey" in good.headers.get("Set-Cookie", ""), good.headers.get("Set-Cookie", ""))
sess = requests.Session()
sess.cookies.update(good.cookies)
frame = sess.get(BASE + "/frame", timeout=10)
check("能抓到画面（JPEG）", frame.status_code == 200 and frame.content[:2] == b"\xff\xd8",
      f"{frame.status_code} {frame.content[:4]!r}")
cmd = sess.post(BASE + "/api/command", json={"command": "lock", "args": {}}, timeout=10).json()
check("命令执行成功", cmd.get("ok") is True, str(cmd))
check("命令真到了处理函数", any(c == "lock" for c, _ in ran), str(ran))

print("\n--- 路 2：这个 IP 连满 3 次 → 免密钥 ---")
fresh = lanweb.LanWeb(
    trust=trust,
    on_command=on_command,
    on_info=lambda: {"name": "高一(3)班一体机", "version": "test"},
    on_frame=on_frame,
    log=lambda m: None,
    port=port + 1,
)
fresh.start()
time.sleep(0.4)
B2 = f"http://127.0.0.1:{port + 1}"
check("免密钥前 trusted=False", requests.get(B2 + "/api/info", timeout=10).json().get("trusted") is False)
trust.record("127.0.0.1", "王老师")
trust.record("127.0.0.1", "王老师")
trust.record("127.0.0.1", "王老师")
check("连满 3 次后 trusted=True", requests.get(B2 + "/api/info", timeout=10).json().get("trusted") is True)
no_key_frame = requests.get(B2 + "/frame", timeout=10)
check("免密钥也能抓画面", no_key_frame.status_code == 200, str(no_key_frame.status_code))
no_key_cmd = requests.post(B2 + "/api/command", json={"command": "unlock"}, timeout=10).json()
check("免密钥也能下命令", no_key_cmd.get("ok") is True, str(no_key_cmd))
fresh.stop()

print("\n--- 绑定信息落盘 ---")
check("bindings 存下来了", bindings.names() == ["王老师"], str(bindings.names()))
check("describe 能看", "王老师" in bindings.describe(), bindings.describe())

web.stop()
check("网页能关", web.running is False)

print(f"\n通过 {passed} 项，失败 {failed} 项")
sys.exit(0 if failed == 0 else 1)
