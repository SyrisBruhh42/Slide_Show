"""Disposable localhost preview of actual viewer/collector with simulated extension APIs.
Does not install an extension, inspect user tabs, or change browser settings.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?')[0]
        if route in ('/viewer', '/collector'):
            shim = '''<script>
            const root = location.origin;
            const sample = letter => ({url:root+'/sample-'+letter+'.svg',type:'image',sourceUrl:root+'/collector',title:'Artwork '+letter});
            const collection = {mediaList:['A','B','C'].map(sample),strictProminent:[sample('B')]};
            window.chrome = {runtime:{id:'fixture-extension',onMessage:{addListener(fn){window.collect=fn;}}},
                storage:{local:{get:async()=>({}),set:(_v,callback)=>callback&&callback()},session:{get:async keys=>Object.fromEntries(keys.map(k=>[k,k.endsWith(':cursor')?null:collection])),set:async()=>{}}},downloads:{download(){}}};
            </script>'''
            if route == '/viewer':
                body = (ROOT / 'src/slideshow/slideshow.html').read_text()
                body = body.replace('<head>', '<head><base href="/src/slideshow/">'+shim)
            else:
                body = '''<!doctype html><meta charset="utf-8"><title>Collection order fixture</title>'''+shim+'''
                <h1>Collection order fixture</h1>
                <p>Page order A, B, C; display area order B, C, A. Collection must stay A, B, C.</p>
                <img src="/sample-A.svg" width="90" height="90" class="thumbnail" alt="Artwork A">
                <img src="/sample-B.svg" width="300" height="300" alt="Artwork B">
                <img src="/sample-C.svg" width="160" height="160" alt="Artwork C">
                <button id="capture">Capture collection</button><pre id="result"></pre>
                <script src="/src/shared/media.js"></script><script src="/src/content_scripts/content.js"></script>
                <script>document.getElementById('capture').onclick=()=>collect({action:'extractMedia'},{id:'fixture-extension'},value=>document.getElementById('result').textContent=JSON.stringify(value,null,2));</script>'''
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(body.encode());return
        if route.startswith('/sample-') and route.endswith('.svg'):
            letter=route[8:-4]
            if letter not in ('A','B','C'):self.send_error(404);return
            colors={'A':'#236a76','B':'#684374','C':'#a56832'}
            body=f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><rect width="900" height="700" fill="{colors[letter]}"/><circle cx="450" cy="350" r="230" fill="#ffffff22"/><text x="450" y="410" text-anchor="middle" font-family="sans-serif" font-size="200" fill="white">{letter}</text></svg>'
            self.send_response(200);self.send_header('Content-Type','image/svg+xml');self.end_headers();self.wfile.write(body.encode());return
        super().do_GET()


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1',8874),partial(Handler,directory=str(ROOT))).serve_forever()
