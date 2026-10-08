"""校验发布包：UTF-8 文件名标志 + 解压后与原树逐字节对比。

用法：python build\\checkzip.py <zip> <原树目录> <解压到哪>
报告写 <解压到哪>\\..\\_zipreport.txt（UTF-8），避免控制台编码干扰。

三个参数都可以不给，默认值全部**从脚本自身位置推导**，克隆到哪台机器都在仓库里：
    zip      <仓库根>\\release\\可爱大肥鱼桌宠-<版本>-win-x64.zip（版本取自 src\\package.json）
   原树      <仓库根>\\stage\\     ← build\\build.mjs 铺出来的那棵发布树
   解压到哪  <仓库根>\\_accept\\ziptest\\
「解压到哪」这块临时目录也认环境变量 BLUEHAIRMAID_ACCEPT_ROOT：
给了就用 <BLUEHAIRMAID_ACCEPT_ROOT>\\ziptest。

仓库根 = 本文件上一级的上一级（build\\ 的父目录），不写字面量。
"""

import hashlib
import io
import json
import os
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "src", "package.json")


def app_version():
    """版本号唯一来源：src\\package.json 的 version（读不到就返回 None）"""
    try:
        with open(PKG, encoding="utf-8") as f:
            return json.load(f)["version"]
    except Exception:
        return None


def default_zip():
    """release\\ 里最新改动的那个 .zip（优先跟当前版本号同名的那份）"""
    ver = app_version()
    rel = os.path.join(ROOT, "release")
    cand = None
    if ver:
        named = os.path.join(rel, "可爱大肥鱼桌宠-%s-win-x64.zip" % ver)
        if os.path.isfile(named):
            cand = named
    if cand is None:
        got = [os.path.join(rel, n) for n in os.listdir(rel)] if os.path.isdir(rel) else []
        got = [p for p in got if p.lower().endswith(".zip") and os.path.isfile(p)]
        if got:
            cand = max(got, key=os.path.getmtime)
    if cand is None:
        raise SystemExit("release\\ 里没有 .zip：先跑 python build\\mkzip.py" +
                         ("（期望 可爱大肥鱼桌宠-%s-win-x64.zip）" % ver if ver else ""))
    return cand


def accept(sub):
    """验收用临时隔离目录：BLUEHAIRMAID_ACCEPT_ROOT 优先，否则 <仓库根>\\_accept\\<sub>"""
    base = os.environ.get("BLUEHAIRMAID_ACCEPT_ROOT") or os.path.join(ROOT, "_accept")
    return os.path.join(base, sub)


ZIP = sys.argv[1] if len(sys.argv) > 1 else default_zip()
SRC = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "stage")
DST = sys.argv[3] if len(sys.argv) > 3 else accept("ziptest")
REPORT = os.path.join(os.path.dirname(DST.rstrip("\\/")), "_zipreport.txt")

KEY = [
    "electron/electron.exe",
    "app/lib/index.js",
    "app/runtime/electron-helper/sprite.js",
    "launcher/main.js",
    "launcher/rec.js",
    "launcher/pet.ico",
    "standalone/main.mjs",
    "standalone/paths.mjs",
    "speech/sherpa/sherpa-onnx.node",
    "speech/sensevoice/models/sensevoice-onnx/model.int8.onnx",
    "node/bin/node.exe",
    "install.ps1",
    "安装.cmd",
    "使用说明.txt",
    "defaults/dsh-pet/screen-watch/state.json",
]


def sha(path, limit=None):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(1 << 20)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main():
    out = io.StringIO()
    t0 = time.time()
    z = zipfile.ZipFile(ZIP)
    names = z.namelist()
    cn = [n for n in names if any(ord(c) > 127 for c in n)]
    bad = [i.filename for i in z.infolist() if any(ord(c) > 127 for c in i.filename) and not (i.flag_bits & 0x800)]
    out.write("zip          : %s\n" % ZIP)
    out.write("zip 大小     : %.1f MB\n" % (os.path.getsize(ZIP) / 1048576))
    out.write("条目         : %d（其中非 ASCII 名字 %d 个）\n" % (len(names), len(cn)))
    out.write("没带 UTF-8 标志的非 ASCII 名字: %s\n" % ("（无）" if not bad else "%d 个" % len(bad)))
    for n in bad[:10]:
        out.write("    ! %r\n" % n)
    out.write("中文名字示例 : %s\n" % ", ".join(sorted(cn)[:6]))

    out.write("\n解压到 %s ...\n" % DST)
    te = time.time()
    z.extractall(DST)
    out.write("解压完成，用时 %.0f 秒\n" % (time.time() - te))

    out.write("\n关键文件逐字节对比（zip 解出来的 vs stage 原树）:\n")
    allok = True
    for k in KEY:
        a = os.path.join(DST, *k.split("/"))
        b = os.path.join(SRC, *k.split("/"))
        if not os.path.exists(a) or not os.path.exists(b):
            out.write("  %-58s 缺失 a=%s b=%s\n" % (k, os.path.exists(a), os.path.exists(b)))
            allok = False
            continue
        sa, sb = os.path.getsize(a), os.path.getsize(b)
        ha, hb = sha(a), sha(b)
        ok = sa == sb and ha == hb
        allok = allok and ok
        out.write("  %-58s %s  %d B\n" % (k, "OK " if ok else "不一样!", sa))

    n_zip = sum(len(f) for _, _, f in os.walk(DST))
    n_src = sum(len(f) for _, _, f in os.walk(SRC))
    out.write("\n解压后文件数 %d / 原树 %d %s\n" % (n_zip, n_src, "一致" if n_zip == n_src else "不一致!"))
    out.write("\n结论：%s（总用时 %.0f 秒）\n" % ("全部通过" if allok and n_zip == n_src else "有问题，看上面", time.time() - t0))

    with open(REPORT, "w", encoding="utf-8") as f:
        f.write(out.getvalue())
    print("report ->", REPORT)


if __name__ == "__main__":
    main()
