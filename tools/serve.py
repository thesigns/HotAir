# A local server for development that tells the browser not to cache anything, so changed modules are always
# loaded (python -m http.server lets Chrome cache them). Run: python tools/serve.py [port]
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
