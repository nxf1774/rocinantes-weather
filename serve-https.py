#!/usr/bin/env python3
"""HTTPS server for the local weather page. Serves public/ on port 8443."""

from __future__ import annotations

import argparse
import http.server
import ssl
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
CERT = ROOT / "certs" / "local.pem"
KEY = ROOT / "certs" / "local-key.pem"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8443)
    parser.add_argument("--bind", default="0.0.0.0")
    args = parser.parse_args()

    if not CERT.is_file() or not KEY.is_file():
        raise SystemExit(f"Missing {CERT} or {KEY}. Generate with mkcert first.")

    import os

    os.chdir(PUBLIC)
    httpd = http.server.ThreadingHTTPServer((args.bind, args.port), http.server.SimpleHTTPRequestHandler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(str(CERT), str(KEY))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"https://127.0.0.1:{args.port}")
    print(f"https://10.174.1.186:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
