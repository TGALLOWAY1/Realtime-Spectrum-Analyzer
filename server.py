"""Simple HTTP server that suppresses BrokenPipeError noise."""
import http.server
import socketserver
import sys

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def handle_one_request(self):
        try:
            super().handle_one_request()
        except BrokenPipeError:
            pass

    def finish(self):
        try:
            super().finish()
        except BrokenPipeError:
            pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("", port), QuietHandler) as httpd:
    print(f"Serving on http://localhost:{port}")
    httpd.serve_forever()
