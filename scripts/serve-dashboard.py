#!/usr/bin/env python3
"""Serve PREVAIL dashboard from frontend/dist with API proxy to backend.

Use when `npm run dev` hangs (low disk / iCloud Documents latency).
Requires: backend running on :8000, dist/ built (`npm run build`).
"""

from __future__ import annotations

import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "frontend" / "dist"
BACKEND = os.environ.get("PREVAIL_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
PORT = int(os.environ.get("PREVAIL_UI_PORT", "5173"))


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("[ui] " + (fmt % args) + "\n")

    def _proxy(self, method: str):
        url = f"{BACKEND}{self.path}"
        body = None
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else None
        req = urllib.request.Request(
            url,
            data=body,
            method=method,
            headers={"Content-Type": self.headers.get("Content-Type", "application/json")},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as exc:
            self.send_response(exc.code)
            self.end_headers()
            self.wfile.write(exc.read())
        except urllib.error.URLError as exc:
            self.send_response(502)
            self.end_headers()
            msg = json.dumps({"error": f"Backend unreachable at {BACKEND}", "detail": str(exc.reason)})
            self.wfile.write(msg.encode())

    def do_GET(self):
        if self.path.startswith(("/v1/", "/health")):
            self._proxy("GET")
        else:
            if self.path == "/":
                self.path = "/index.html"
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/v1/"):
            self._proxy("POST")
        else:
            self.send_response(405)
            self.end_headers()


def run_ws_proxy():
    """Proxy WebSocket /ws/live -> backend (optional, needs websockets)."""
    try:
        import asyncio
        import websockets
    except ImportError:
        print("[ui] websockets not installed; WS proxy skipped", file=sys.stderr)
        return

    backend_ws = BACKEND.replace("http", "ws", 1) + "/ws/live"

    async def relay(websocket):
        async with websockets.connect(backend_ws) as upstream:
            async def to_client():
                async for msg in upstream:
                    await websocket.send(msg)

            async def to_upstream():
                async for msg in websocket:
                    await upstream.send(msg)

            await asyncio.gather(to_client(), to_upstream())

    async def main():
        async with websockets.serve(relay, "127.0.0.1", 5174, ping_interval=None):
            await asyncio.Future()

    asyncio.run(main())


def main():
    if not DIST.joinpath("index.html").exists():
        print(f"ERROR: {DIST} missing — run: cd frontend && npm run build", file=sys.stderr)
        sys.exit(1)

    # WebSocket on 5174; rebuild with VITE_WS_URL=ws://127.0.0.1:5174/ws/live if needed
    # Default dist uses same-host /ws/live — run WS proxy on PORT via separate approach
    print(f"[ui] Serving {DIST} at http://127.0.0.1:{PORT}")
    print(f"[ui] Proxying /v1/* -> {BACKEND}")
    print("[ui] Ensure backend is running on :8000")

    server = ThreadingHTTPServer(("127.0.0.1", PORT), DashboardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[ui] stopped")


if __name__ == "__main__":
    main()
