#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""比对「安装程序装出来的目录」和 stage\ 是否逐字节一致。

为什么要它：NSIS 的 File /r 只保证「文件都在」，万一压缩包坏了、或者 /x 排除规则写错，
装机演练里数一数文件个数是看不出来的。这里把 stage\（减去安装器不该带的脚本版安装文件）
和装出来的目录逐文件比大小 + sha256，多的少的都报出来。

用法：
    python build\verify-install.py <stage 目录> <装出来的目录>
退出码 0 = 完全一致。
"""
import hashlib
import os
import sys

# 安装程序用 /x 排掉的（脚本版安装器）—— 装出来的目录里不该有
EXCLUDE = {"install.ps1", "uninstall.ps1", "安装.cmd", "卸载.cmd", "portable.txt"}
# 装出来的目录里多出来的（NSIS 自己写的卸载器）
EXTRA_OK = {"Uninstall.exe"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def walk(root, skip_names, skip_dirs=()):
    out = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for name in filenames:
            if name in skip_names:
                continue
            full = os.path.join(dirpath, name)
            if os.path.isfile(full):
                out[os.path.relpath(full, root)] = full
    return out


def main():
    stage, inst = sys.argv[1], sys.argv[2]
    want = walk(stage, EXCLUDE, skip_dirs={"_newpc", "_testuser"})
    got = walk(inst, set())

    missing = sorted(set(want) - set(got))
    extra = sorted(set(got) - set(want) - EXTRA_OK)
    print("stage 应有 %d 个文件（已排除 %s）" % (len(want), "、".join(sorted(EXCLUDE))))
    print("实装     %d 个文件" % len(got))
    if missing:
        print("!! 少装 %d 个：%s" % (len(missing), missing[:10]))
    if extra:
        print("!! 多出 %d 个：%s" % (len(extra), extra[:10]))

    bad = []
    total = 0
    for rel in sorted(set(want) & set(got)):
        a, b = want[rel], got[rel]
        sa, sb = os.path.getsize(a), os.path.getsize(b)
        total += sb
        if sa != sb:
            bad.append((rel, "大小 %d != %d" % (sa, sb)))
        elif sha256(a) != sha256(b):
            bad.append((rel, "内容 sha256 不一致"))
    if bad:
        print("!! 不一致 %d 个：" % len(bad))
        for rel, why in bad[:10]:
            print("   %s: %s" % (rel, why))
    print("逐字节一致：%d 个；实装总字节 %d" % (len(set(want) & set(got)) - len(bad), total))
    if missing or extra or bad:
        print("结论：不一致")
        return 1
    print("结论：完全一致（多出来的只有 Uninstall.exe）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
