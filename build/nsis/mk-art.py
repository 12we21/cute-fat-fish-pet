#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成安装向导与快捷方式用的美术素材（不是打包脚本的一部分，改了重跑一次即可）。

用法（需要带 Pillow 的 Python 3；Windows 商店那个 python 占位符跑不了）：
  python build\\nsis\\mk-art.py

输入：build\\nsis\\pet-src-256.png —— **蓝毛小女仆那张快捷方式图标的 256 立绘**，
另存自那位蓝本工程的 launcher\\pet.ico（= 桌面「蓝毛小女仆」快捷方式用的图标）的第 256 层，
见本目录 README 的「图标来源」一节。它是**不透明白底**的：四角都是 (255,255,255)。

为什么不用蓝本动画抠帧了：早先从 `打瞌睡被惊醒.webm` 8.8 秒处 colorkey 抠出来的立绘，
边缘带着黑底残留与麻点（放大看有暗边、白点），做出来的快捷方式图标与向导竖幅都有瑕疵。
现在改成把主人满意的这张白底立绘**干净地抠白**（见 cut_from_white），边缘不反预乘就会留一圈白毛边。

产出：
  build\\nsis\\welcome.bmp            164x314  欢迎页 / 完成页左侧竖幅（必须 24 位 BMP）
  build\\nsis\\header.bmp             150x57   内页右上角小横条（必须 24 位 BMP）
  overlay\\launcher\\pet.ico          多尺寸图标：快捷方式 / 任务栏 / 向导标题栏 / 控制面板图标
     —— 覆盖蓝本那个白底方块的 pet.ico（overlay\\ 永远覆盖蓝本，见 build\\build.mjs 的 applyOverlay）

为什么图标要自己重画：蓝本的 launcher\\pet.ico 七层全是**不透明**的（alpha 极值 255/255），
白底方块会跟着出现在快捷方式、任务栏、「应用和功能」的图标里，很难看；
但那张画本身是主人认可的样子，所以保留画、只把白底换成真透明。
"""
import os
import random
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.dirname(os.path.dirname(HERE))
POSE = os.path.join(HERE, "pet-src-256.png")
ICO_OUT = os.path.join(DIST, "overlay", "launcher", "pet.ico")

BG_TOP = (18, 27, 62)
BG_MID = (37, 72, 152)
BG_BOT = (122, 168, 231)


def cut_from_white(im, tol=18, band=2, dark_ref=48.0):
    """白底立绘 -> 真透明贴纸。

    1) 背景 = 从四边泛洪、颜色接近纯白（255 - min(r,g,b) <= tol）的连通块；
    2) 紧贴背景的 1~2 圈像素是「线稿 over 白」的混合像素，用暗度估 alpha 并**反预乘**，
       否则它们会带着白，放到深色背景上就是一圈白毛边；
    3) 画里面的浅色（围裙、头饰）离背景远，保持不透明，不会被掏空。
    """
    im = im.convert("RGBA")
    arr = np.asarray(im).astype(np.float32)
    rgb = arr[..., :3]
    h, w = rgb.shape[:2]
    d = 255.0 - rgb.min(axis=2)          # 纯白 = 0
    cand = d <= tol                      # 候选背景
    reach = np.zeros((h, w), dtype=bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not reach[y, x]:
                reach[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not reach[y, x]:
                reach[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not reach[ny, nx]:
                reach[ny, nx] = True
                dq.append((ny, nx))

    alpha = np.ones((h, w), dtype=np.float32)
    alpha[reach] = 0.0
    pmin = rgb.min(axis=2)
    for _ in range(band):
        nb = np.zeros((h, w), dtype=bool)
        nb[1:, :] |= alpha[:-1, :] == 0
        nb[:-1, :] |= alpha[1:, :] == 0
        nb[:, 1:] |= alpha[:, :-1] == 0
        nb[:, :-1] |= alpha[:, 1:] == 0
        edge = nb & (alpha > 0)
        if not edge.any():
            break
        est = np.clip((255.0 - pmin) / (255.0 - dark_ref), 0.0, 1.0)
        alpha[edge] = np.minimum(alpha[edge], est[edge])

    a3 = alpha[..., None]
    out_rgb = np.where(a3 > 0.02, (rgb - (1.0 - a3) * 255.0) / np.maximum(a3, 0.02), rgb)
    out = np.concatenate([np.clip(out_rgb, 0, 255), (alpha * 255.0)[..., None]], axis=2).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def trim(im, pad=2):
    """按 alpha 裁掉四周空白，留一点边距。"""
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return im
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad),
           min(im.width, xs.max() + 1 + pad), min(im.height, ys.max() + 1 + pad))
    return im.crop(box)


def pose(size_h):
    """立绘：白底抠干净、裁掉空白，再缩放到指定高度，返回 RGBA。"""
    im = cut_from_white(Image.open(POSE))
    im = trim(im)
    w = max(1, int(round(im.width * size_h / im.height)))
    return im.resize((w, size_h), Image.LANCZOS)


def vgrad(w, h, stops):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        for i in range(len(stops) - 1):
            t0, c0 = stops[i]
            t1, c1 = stops[i + 1]
            if t0 <= t <= t1:
                k = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
                d.line([(0, y), (w, y)], fill=tuple(int(round(c0[j] + (c1[j] - c0[j]) * k)) for j in range(3)))
                break
    return img


def bubbles(w, h, n, seed, ymax=None, rmax=9):
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    rnd = random.Random(seed)
    d = ImageDraw.Draw(layer, "RGBA")
    ymax = ymax or h
    for _ in range(n):
        r = rnd.randint(3, rmax)
        x = rnd.randint(r, w - r)
        y = rnd.randint(r, max(r + 1, ymax - r))
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rnd.randint(38, 96)))
    return layer


def glow(w, h, cx, cy, rad, alpha=70):
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=alpha)
    mask = mask.filter(ImageFilter.GaussianBlur(rad / 2.0))
    white = Image.new("L", (w, h), 255)
    return Image.merge("RGBA", (white, white, white, mask))


def make_welcome(path):
    w, h = 164, 314
    base = vgrad(w, h, [(0.0, BG_TOP), (0.45, BG_MID), (1.0, BG_BOT)]).convert("RGBA")
    base.alpha_composite(glow(w, h, w // 2, 205, 70, 84))
    base.alpha_composite(bubbles(w, h, 34, 20261008, ymax=250))
    p = pose(188)
    base.alpha_composite(p, ((w - p.width) // 2, h - p.height - 8))
    base.convert("RGB").save(path, "BMP")
    print("welcome:", path, base.size)


def make_header(path):
    w, h = 150, 57
    base = vgrad(w, h, [(0.0, (26, 36, 78)), (1.0, (60, 104, 190))]).convert("RGBA")
    base.alpha_composite(bubbles(w, h, 14, 777, ymax=h, rmax=6))
    p = pose(52)
    base.alpha_composite(p, (w - p.width - 5, h - p.height - 3))
    base.convert("RGB").save(path, "BMP")
    print("header:", path, base.size)


def make_ico(path):
    """多尺寸真透明图标：256 画布上把立绘放好，再让 Pillow 逐层缩。"""
    side = 256
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    p = pose(int(side * 0.96))
    if p.width > side - 4:          # 太宽就按宽度缩
        p = p.resize((side - 4, max(1, int(p.height * (side - 4) / p.width))), Image.LANCZOS)
    canvas.alpha_composite(p, ((side - p.width) // 2, side - p.height - 2))
    canvas.save(path, format="ICO",
                sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("ico:", path, os.path.getsize(path), "B")


if __name__ == "__main__":
    os.makedirs(os.path.dirname(ICO_OUT), exist_ok=True)
    make_welcome(os.path.join(HERE, "welcome.bmp"))
    make_header(os.path.join(HERE, "header.bmp"))
    make_ico(ICO_OUT)
