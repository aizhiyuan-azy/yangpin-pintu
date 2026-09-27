# -*- coding: utf-8 -*-
"""把网页推到 GitHub，供苹果 Safari 打开。"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REMOTE = "https://github.com/aizhiyuan-azy/yangpin-pintu.git"
PAGES_URL = "https://aizhiyuan-azy.github.io/yangpin-pintu/"


def setup_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def run_git(args):
    return subprocess.call(["git"] + args, cwd=ROOT)


def main():
    setup_stdout()
    os.chdir(ROOT)
    print("正在推送到 " + REMOTE)
    subprocess.call(
        ["git", "remote", "remove", "origin"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if run_git(["remote", "add", "origin", REMOTE]) != 0:
        print("添加远程地址失败。")
        return
    code = run_git(["push", "-u", "origin", "main"])
    if code != 0:
        print("推送失败。请确认仓库已建好：https://github.com/aizhiyuan-azy/yangpin-pintu")
        return
    print("推送成功。")
    print("请打开：https://github.com/aizhiyuan-azy/yangpin-pintu/settings/pages")
    print("Source 选 Deploy from a branch，Branch 选 main，Folder 选 /docs，保存。")
    print("苹果用 Safari 打开：")
    print(PAGES_URL)


if __name__ == "__main__":
    main()
