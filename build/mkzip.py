r"""打发布包：把 stage\\ 压成 zip。

为什么不用 Windows 自带的 tar：bsdtar 会把中文文件名写成系统 ANSI(GBK) 字节
且不设 UTF-8 标志位（0x800），换一台非中文系统解压就会变乱码。
Python 的 zipfile 遇到非 ASCII 名字会自动带上 UTF-8 标志位，Explorer / 7-Zip 都认。

用法：
    python build\\mkzip.py                 # stage\ -> release\cute-fat-fish-pet-<版本>-win-x64.zip
    python build\\mkzip.py <源目录> <输出.zip>
版本号取自 src\\package.json（唯一来源）。
"""

import hashlib
import json
import os
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def app_version():
    with open(ROOT / "src" / "package.json", encoding="utf-8") as f:
        return json.load(f)["version"]


VER = app_version()
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "stage"
OUT = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / "release" / ("cute-fat-fish-pet-%s-win-x64.zip" % VER)
# 文件名只用 ASCII：GitHub Release 会删掉资产名里的非 ASCII 字符（"可爱大肥鱼桌宠-1.1.0-…"
# 上传后变成 "-1.1.0-…"），所以对外发布的文件名保持英文。
SKIP_DIRS = {"_newpc", "_testuser"}
SKIP_NAMES = {"portable.txt"}


def walk(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if name in SKIP_NAMES:
                continue
            full = os.path.join(dirpath, name)
            if os.path.islink(full) or not os.path.isfile(full):
                continue
            yield full, os.path.relpath(full, root)


def main():
    os.makedirs(OUT.parent, exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    t0 = time.time()
    total_raw = 0
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for full, rel in walk(str(SRC)):
            arc = rel.replace("\\", "/")
            z.write(full, arc)
            total_raw += os.path.getsize(full)
            count += 1
            if count % 200 == 0:
                print("  ... %d 个文件 / %.0f MB 已压入" % (count, total_raw / 1048576), flush=True)
    size = os.path.getsize(OUT)
    print("完成：%d 个文件，原始 %.1f MB -> 压缩后 %.1f MB，用时 %.0f 秒" % (count, total_raw / 1048576, size / 1048576, time.time() - t0))
    print("输出：%s" % OUT)
    # 一起写 .sha256（UTF-8 带 BOM，格式 <哈希>  <文件名>），发布时直接贴给用户核对
    h = hashlib.sha256()
    with open(OUT, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    sha = OUT.with_suffix(OUT.suffix + ".sha256")
    sha.write_text("%s  %s\r\n" % (h.hexdigest().upper(), OUT.name), encoding="utf-8-sig")
    print("SHA256：%s" % h.hexdigest().upper())
    print("校验文件：%s" % sha)


if __name__ == "__main__":
    main()
