"""Static server for the two development pages.

The app itself only runs inside Home Assistant now — it needs the `hass` object
the frontend hands a panel — so there is nothing here to proxy. What this does
serve is `selftest.html` and `preview.html`, both of which are pure computation
against stubbed data and never touch Home Assistant.

Caching is off so an edit shows up on reload. (Home Assistant serves the
deployed panel the same way; see custom_components/family_calendar/__init__.py.)

Standard library only; there is no package manager in this project.

Usage:
    python devserver.py [--port 8080]
"""

from __future__ import annotations

import argparse
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_request(self, code="-", size="-"):
        # Only failures are worth the noise.
        status = code.value if hasattr(code, "value") else code
        if isinstance(status, int) and status >= 400:
            sys.stderr.write(f"  {self.command} {self.path} -> {status}\n")

    def log_error(self, *args):
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080, help="port to listen on")
    args = parser.parse_args()

    try:
        server = ThreadingHTTPServer(("0.0.0.0", args.port), NoCacheHandler)
    except OSError as err:
        print(f"  Cannot listen on port {args.port}: {err}", file=sys.stderr)
        print(f"  Try: serve.ps1 -Port {args.port + 1}", file=sys.stderr)
        return 1

    print(
        "\n".join(
            [
                "",
                f"  selftest  http://localhost:{args.port}/selftest.html",
                f"  preview   http://localhost:{args.port}/preview.html",
                "",
                "  The app itself runs only as a Home Assistant panel.",
                "  Ctrl+C to stop.",
                "",
            ]
        ),
        flush=True,
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
