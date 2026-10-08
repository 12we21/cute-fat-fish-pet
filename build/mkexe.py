#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""打 Windows 安装程序（NSIS）。

为什么单独写一个：makensis 的路径、版本号、输出文件名这三件事不该手打。
版本号取自 src\\package.json（唯一来源），产物固定是
    release\\cute-fat-fish-pet-<版本>-setup.exe
（文件名只用 ASCII：GitHub Release 会删掉资产名里的非 ASCII 字符，中文产品名
仍然留在安装界面、「应用和功能」和快捷方式里。）
并顺手算好 SHA256 写成同名 .sha256（UTF-8 带 BOM，格式 <哈希>  <文件名>）。

用法：
    python build\\mkexe.py                 # 真打（约 9 分钟，765 MB / LZMA）
    python build\\mkexe.py --quick         # 只做语法快检（等价于 nsi-syntax-check.py）
环境变量：
    MAKENSIS=<makensis.exe 路径>           # 找不到时用它指
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NSI = ROOT / "build" / "installer.nsi"


def app_version():
    with open(ROOT / "src" / "package.json", encoding="utf-8") as f:
        return json.load(f)["version"]


def find_makensis():
    env = os.environ.get("MAKENSIS")
    if env and os.path.isfile(env):
        return env
    for c in (r"C:\Program Files (x86)\NSIS\makensis.exe", r"C:\Program Files\NSIS\makensis.exe"):
        if os.path.isfile(c):
            return c
    got = shutil.which("makensis")
    if got:
        return got
    print("找不到 makensis.exe。装一个 NSIS（https://nsis.sourceforge.io/），")
    print("或用环境变量指出来：set MAKENSIS=<makensis.exe 的完整路径>")
    sys.exit(2)


def sha256_file(p, buf=1 << 20):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(buf), b""):
            h.update(chunk)
    return h.hexdigest().upper()


def main():
    quick = "--quick" in sys.argv
    if quick:
        return subprocess.call([sys.executable, str(ROOT / "build" / "nsi-syntax-check.py")])

    ver = app_version()
    stage = ROOT / "stage"
    exe = ROOT / "release" / ("cute-fat-fish-pet-%s-setup.exe" % ver)

    # 打包前先看看 stage 是不是像样的（省得编了 9 分钟才发现是空的）
    must = [stage / "electron" / "electron.exe", stage / "launcher" / "pet.ico", stage / "app" / "package.json"]
    missing = [str(p.relative_to(ROOT)) for p in must if not p.is_file()]
    if missing:
        print("stage\\ 还不齐：缺 " + "、".join(missing))
        print("先铺一遍：node build\\build.mjs        （外部件见 node build\\toolchain.mjs）")
        return 2

    mk = find_makensis()
    print("makensis : %s" % mk)
    print("版本     : %s" % ver)
    print("安装脚本 : %s" % NSI)
    print("产物     : %s" % exe)
    print("（全量 LZMA 压缩约 9 分钟，请等）")
    t0 = time.time()
    exe.parent.mkdir(parents=True, exist_ok=True)
    rc = subprocess.call([mk, "/V4", "/INPUTCHARSET", "UTF8", "/DAPP_VER=%s" % ver, str(NSI)])
    if rc != 0:
        print("makensis 退出码 %d，没打成。" % rc)
        return rc
    if not exe.is_file():
        print("makensis 说成功，但没看到 %s" % exe)
        return 3

    size = exe.stat().st_size
    digest = sha256_file(exe)
    (exe.parent / (exe.name + ".sha256")).write_text(
        "%s  %s\r\n" % (digest, exe.name), encoding="utf-8-sig"
    )
    print("完成：%s" % exe)
    print("  %d 字节（%.1f MB），用时 %.0f 秒" % (size, size / 1048576, time.time() - t0))
    print("  SHA256：%s" % digest)
    print("  校验文件：%s.sha256" % exe.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
