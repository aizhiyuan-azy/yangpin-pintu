# -*- coding: utf-8 -*-
"""
在车间电脑上启动本地网页。手机连同一 WiFi 后，浏览器打开控制台里打印的地址即可。
不依赖第三方库，改下面两个变量就能换端口或网页目录。
"""

import os
import socket
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 方便改本地地址：网页文件夹、端口
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
PORT = 8080


def setup_stdout():
    """Windows 控制台按 UTF-8 打印中文，减少乱码。"""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def get_lan_ip():
    """取本机局域网 IP，供手机访问。失败时退回 127.0.0.1。"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(1)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return "127.0.0.1"


class NoCacheHandler(SimpleHTTPRequestHandler):
    """车间调试时禁止缓存，避免手机还在用旧页面。"""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        sys.stdout.write("[访问] " + (format % args) + "\n")


def main():
    setup_stdout()
    if not os.path.isdir(WEB_DIR):
        print("找不到网页目录：" + WEB_DIR)
        print("请确认 start_server.py 旁边有 web 文件夹。")
        return

    os.chdir(WEB_DIR)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler)
    lan_ip = get_lan_ip()
    lines = [
        "========================================",
        "样品拍照拼图 已启动",
        "电脑预览： http://127.0.0.1:" + str(PORT) + "/",
        "手机打开： http://" + lan_ip + ":" + str(PORT) + "/",
        "别人怎么打开：手机连同一 WiFi，浏览器打开上面「手机打开」那行地址。",
        "不需要互联网。电脑要一直开着这个窗口。请用 Safari / Chrome，不要用微信。",
        "发微信时勾选「原图」。按 Ctrl+C 停止。",
        "========================================",
    ]
    print("\n".join(lines), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止服务。")
        server.server_close()


if __name__ == "__main__":
    main()
