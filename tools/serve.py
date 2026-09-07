#!/usr/bin/env python3
"""開発用の静的配信サーバー。

python3 -m http.server はブラウザにキャッシュを許すため、js を更新しても
古いモジュールが読み込まれて壊れることがある。ここではキャッシュを完全に止める。

全インターフェースにバインドするので、同じWi-Fiにいる実機からも開ける。
起動時にLANのアドレスを表示するので、iPhoneのSafariにそれを入力する。

使い方:
    python3 tools/serve.py            # http://localhost:8765
    python3 tools/serve.py 9000       # ポート指定
"""

import functools
import http.server
import pathlib
import socket
import socketserver
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_PORT = 8765


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 404だけ目立たせ、通常の200は静かにする
        msg = fmt % args
        if " 404 " in msg or "404" in str(args):
            sys.stderr.write(f"  404 {self.path}\n")


class ReusableServer(socketserver.TCPServer):
    allow_reuse_address = True


def lan_address():
    """このマシンのLAN側アドレス。実機から開くときに使う。取れなければ None"""
    try:
        # 外へは実際に送らない。経路表からLAN側のアドレスを引くためだけのUDPソケット
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))

    with ReusableServer(("", port), handler) as httpd:
        print(f"配信中: http://localhost:{port}")
        lan = lan_address()
        if lan:
            print(f"実機から:  http://{lan}:{port}   （同じWi-Fiに繋いだiPhoneのSafariで開く）")
        print(f"公開ディレクトリ: {ROOT}")
        print("キャッシュ無効。止めるには Ctrl+C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n停止しました")


if __name__ == "__main__":
    main()
