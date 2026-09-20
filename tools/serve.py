# -*- coding: utf-8 -*-
"""Serve the page for development, without letting anything be cached.

The app's own assets are served by the Android side; this is the same tree over http, so the page can
be opened in a desktop browser while working on it. Everything is sent with `no-store`, because a
browser that holds on to a module makes an edit look like it did nothing - the most expensive kind of
confusion there is.

    python tools/serve.py [port]
"""
import functools, http.server, os, sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    'app', 'src', 'main', 'assets')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass                                   # a quiet server: the browser's console is the log


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    handler = functools.partial(Handler, directory=ROOT)
    print(f'VEO assets on http://localhost:{port}/booth.html  (nothing is cached)')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()


if __name__ == '__main__':
    main()
