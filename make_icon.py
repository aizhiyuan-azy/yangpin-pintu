# -*- coding: utf-8 -*-
"""
画一个 180×180 的清新图标：米色底 + 鼠尾草绿 3×3 圆角格。
给苹果「添加到主屏幕」和网页图标用，不要红点黑底（太像日本国旗）。
"""

import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "icon.png")
SIZE = 180
# 和页面主色一致：米灰底、草绿格
BG = (244, 241, 234)
CELL = (107, 143, 113)


def chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def in_round_rect(px, py, left, top, right, bottom, radius):
    """点是否落在圆角矩形内。"""
    if px < left or px > right or py < top or py > bottom:
        return False
    cx = min(max(px, left + radius), right - radius)
    cy = min(max(py, top + radius), bottom - radius)
    dx = px - cx
    dy = py - cy
    return dx * dx + dy * dy <= radius * radius


def main():
    margin = 30
    gap = 10
    inner = SIZE - margin * 2
    cell = (inner - gap * 2) / 3.0
    radius = 12

    rows = []
    for y in range(SIZE):
        raw = [0]
        for x in range(SIZE):
            color = BG
            for row in range(3):
                for col in range(3):
                    left = margin + col * (cell + gap)
                    top = margin + row * (cell + gap)
                    if in_round_rect(
                        x + 0.5,
                        y + 0.5,
                        left,
                        top,
                        left + cell,
                        top + cell,
                        radius,
                    ):
                        color = CELL
            raw.extend(color)
        rows.append(bytes(raw))

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")
    with open(OUT, "wb") as handle:
        handle.write(png)
    print("已生成：" + OUT)


if __name__ == "__main__":
    main()
