#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""NSIS 安装脚本「语法 + 美术」快速自检：用一个假 stage 目录编译一遍，几十秒出结果。

为什么需要它：真包编译要 ~9 分钟（765 MB / LZMA），改一行 !define 就想知道有没有写错时太慢。
这个脚本把 installer.nsi 里的 STAGE 换成一个假目录（只放几个占位文件），OutFile 换成
build\_nsitest.exe，其余原样，编译一遍就能验证：所有页面宏、BMP/ICO 尺寸、
Section 逻辑、卸载段语法。

用法：
  python build\\nsi-syntax-check.py
退出码 0 = 通过。日志：build\\_nsi-syntax.log
* 会在仓库根建一个 `_nsitest\\` 临时假安装目录（已进 .gitignore），可以随时删。
"""
import os
import re
import shutil
import subprocess
import sys

# 中文 Windows 上 stdout 重定向给管道时按 GBK 编码，makensis 日志里的坏字节解码成 U+FFFD
# 就编不回去 → 直接崩。这里让不可编码的字符退化成 '?'，不要因为打印失败而丢结论。
try:
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")
except Exception:
    pass

DIST = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(DIST, "build", "installer.nsi")
FAKE = os.path.join(DIST, "_nsitest")
OUT_NSI = os.path.join(DIST, "build", "_nsi-syntax.nsi")
OUT_EXE = os.path.join(DIST, "build", "_nsitest.exe")
LOG = os.path.join(DIST, "build", "_nsi-syntax.log")


def find_makensis():
    """NSIS 装在哪台电脑上都不一样：先看环境变量，再看常见安装位置，最后看 PATH。"""
    env = os.environ.get("MAKENSIS")
    if env and os.path.isfile(env):
        return env
    cands = [
        r"C:\Program Files (x86)\NSIS\makensis.exe",
        r"C:\Program Files\NSIS\makensis.exe",
    ]
    for c in cands:
        if os.path.isfile(c):
            return c
    got = shutil.which("makensis")
    if got:
        return got
    print("找不到 makensis.exe。装一个 NSIS（https://nsis.sourceforge.io/），")
    print("或用环境变量指出来：set MAKENSIS=<makensis.exe 的完整路径>")
    sys.exit(2)


MAKENSIS = find_makensis()


def main():
    # 假 stage：只要 installer.nsi 引用到的路径都在，编译就能过
    os.makedirs(os.path.join(FAKE, "launcher"), exist_ok=True)
    os.makedirs(os.path.join(FAKE, "electron"), exist_ok=True)
    for rel, data in (
        (r"launcher\pet.ico", None),          # 从真 stage 拷（MUI_ICON 要能打开）
        (r"使用说明.txt", b"dummy\n"),
        (r"electron\dummy.bin", b"x" * 1024),
    ):
        dst = os.path.join(FAKE, rel)
        if data is None:
            src = os.path.join(DIST, "stage", rel)
            with open(src, "rb") as f:
                data = f.read()
        with open(dst, "wb") as f:
            f.write(data)

    with open(SRC, encoding="utf-8-sig") as f:
        text = f.read()
    text, n1 = re.subn(r'!define STAGE\s+"[^"]*"', '!define STAGE "%s"' % FAKE.replace("\\", "\\\\"), text)
    text, n2 = re.subn(r'OutFile\s+"[^"]*"', 'OutFile "%s"' % OUT_EXE.replace("\\", "\\\\"), text)
    if n1 != 1 or n2 != 1:
        print("替换失败：STAGE %d 次、OutFile %d 次（各应为 1）" % (n1, n2))
        return 2
    with open(OUT_NSI, "w", encoding="utf-8-sig", newline="\r\n") as f:
        f.write(text)

    print("makensis ...")
    with open(LOG, "w", encoding="utf-8", errors="replace") as lg:
        rc = subprocess.call([MAKENSIS, "/V4", "/INPUTCHARSET", "UTF8", OUT_NSI], stdout=lg, stderr=subprocess.STDOUT)
    tail = open(LOG, encoding="utf-8", errors="replace").read().strip().splitlines()[-15:]
    print("exit=%d" % rc)
    print("\n".join(tail))
    return 0 if rc == 0 else rc


if __name__ == "__main__":
    sys.exit(main())
