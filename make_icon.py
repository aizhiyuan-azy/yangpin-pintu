# -*- coding: utf-8 -*-
"""画一个 180×180 的红点图标，给苹果「添加到主屏幕」用。"""

import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "icon.png")
SIZE = 180


def chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def main():
    rows = []
    cx = cy = SIZE / 2.0
    radius = 58
    for y in range(SIZE):
        raw = [0]
        for x in range(SIZE):
            dx = x - cx
            dy = y - cy
            inside = dx * dx + dy * dy <= radius * radius
            if inside:
                raw.extend((229, 57, 53))
            else:
                raw.extend((18, 18, 18))
        rows.append(bytes(raw))
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")
    with open(OUT, "wb") as handle:
        handle.write(png)


if __name__ == "__main__":
    main()
