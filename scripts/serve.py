#!/usr/bin/env python3
"""로컬 개발 서버 (표준 라이브러리만 사용)

    python scripts/serve.py            # http://localhost:8000  (web/ 폴더)
    python scripts/serve.py 8080

`python -m http.server`와 같지만 MIME 타입을 고정합니다.
Windows에서는 레지스트리 설정 때문에 .js가 text/plain으로 나가는 경우가 있고,
그러면 브라우저가 ES 모듈(js/main.js) 로드를 거부해 화면이 비어 보입니다.
"""
import functools
import http.server
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    }

    def do_GET(self):
        # config.js가 없으면 빈 설정을 돌려줘서 데모 모드로 열리게 한다 (Console 404 방지)
        if self.path.split("?")[0] == "/config.js" and not (WEB / "config.js").exists():
            body = b"/* config.js \xec\x97\x86\xec\x9d\x8c \xe2\x86\x92 \xeb\x8d\xb0\xeb\xaa\xa8 \xeb\xaa\xa8\xeb\x93\x9c (scripts/serve.py) */\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_request(self, code="-", size="-"):
        if str(code).isdigit() and int(code) >= 400:   # 정상 요청은 조용히, 오류만 표시
            super().log_request(code, size)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # 개발 중 수정한 파일이 바로 보이도록
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128   # 기본값 5는 모듈 여러 개를 동시에 받을 때 연결 거부가 날 수 있음
    daemon_threads = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(Handler, directory=str(WEB))
    with Server(("127.0.0.1", port), handler) as httpd:   # 내 컴퓨터에서만 접속 가능
        print(f"web/ 폴더를 http://127.0.0.1:{port} 에서 제공합니다 (Ctrl+C로 종료)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
