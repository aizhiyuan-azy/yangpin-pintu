# -*- coding: utf-8 -*-
"""
把网页打包成一个 HTML。拷到手机后，用 Chrome 打开即可，不连电脑、不用流量。
"""

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
OUT_FILE = os.path.join(ROOT, "样品拍照拼图.html")


def setup_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def read_text(path):
    if not os.path.isfile(path):
        raise FileNotFoundError("找不到文件：" + path)
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def main():
    setup_stdout()
    html = read_text(os.path.join(WEB_DIR, "index.html"))
    css = read_text(os.path.join(WEB_DIR, "app.css"))
    scripts = [
        "js/config.js",
        "js/storage.js",
        "js/save.js",
        "js/collage.js",
        "js/editor.js",
        "js/main.js",
    ]
    js_parts = [read_text(os.path.join(WEB_DIR, name)) for name in scripts]

    html = html.replace('<link rel="manifest" href="manifest.webmanifest">', "")
    html = html.replace('<link rel="apple-touch-icon" href="icon.png">', "")
    html = html.replace(
        '<link rel="stylesheet" href="app.css">',
        "<style>\n" + css + "\n</style>",
    )
    html = html.replace(
        '<script src="js/config.js"></script>\n    <script src="js/storage.js"></script>\n    <script src="js/save.js"></script>\n    <script src="js/collage.js"></script>\n    <script src="js/editor.js"></script>\n    <script src="js/main.js"></script>',
        "<script>\n" + "\n".join(js_parts) + "\n</script>",
    )

    with open(OUT_FILE, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(html)

    print("已生成：" + OUT_FILE)
    print("请把这个 HTML 发到安卓手机，用百度浏览器打开。不要用 Chrome，不要用微信。")


if __name__ == "__main__":
    main()
