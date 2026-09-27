# -*- coding: utf-8 -*-
"""把 web 目录同步到 docs，供 GitHub Pages 发布（苹果 Safari 打开 https 地址）。"""

import os
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
DOCS_DIR = os.path.join(ROOT, "docs")


def setup_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def main():
    setup_stdout()
    if not os.path.isdir(WEB_DIR):
        print("找不到 web 目录")
        return
    if os.path.isdir(DOCS_DIR):
        shutil.rmtree(DOCS_DIR)
    shutil.copytree(WEB_DIR, DOCS_DIR)
    # 让 GitHub Pages 不要用 Jekyll 处理，避免下划线文件被丢掉
    with open(os.path.join(DOCS_DIR, ".nojekyll"), "w", encoding="utf-8") as handle:
        handle.write("")
    print("已同步到 docs，可发布 GitHub Pages。")


if __name__ == "__main__":
    main()
