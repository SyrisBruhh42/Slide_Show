"""Disposable localhost preview of actual viewer/collector with simulated extension APIs.
Does not install an extension, inspect user tabs, or change browser settings.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import argparse

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?')[0]
        if route in ('/viewer', '/collector'):
            shim = '''<script>
            const root = location.origin;
            const sample = letter => ({id:root+'/sample-'+letter+'.svg',url:root+'/sample-'+letter+'.svg',type:'image',sourceUrl:root+'/collector',title:'Artwork '+letter});
            const collection = {mediaList:['A','B','C'].map(sample),strictProminent:[sample('B')]};
            const fixtureId='11111111-1111-1111-1111-111111111111';
            const channel=new BroadcastChannel('disposable-collection-fixture');
            channel.onmessage=event=>{if(event.data.request && window.collect) collect(event.data.request,{id:'fixture-extension'},value=>{if(value.data)localStorage.setItem('fixture-collection',JSON.stringify(value.data));channel.postMessage({reply:event.data.token,value});});};
            window.chrome = {runtime:{id:'fixture-extension',onMessage:{addListener(fn){window.collect=fn;}},sendMessage:request=>new Promise((resolve,reject)=>{
                const token=crypto.randomUUID();const timer=setTimeout(()=>{channel.removeEventListener('message',receive);reject(new Error('Open the collector fixture first.'));},2000);
                function receive(event){if(event.data.reply===token){clearTimeout(timer);channel.removeEventListener('message',receive);resolve(event.data.value);}}
                channel.addEventListener('message',receive);channel.postMessage({request,token});})},
                storage:{local:{get:async()=>({}),set:(_v,callback)=>callback&&callback()},session:{get:async keys=>Object.fromEntries(keys.map(k=>[k,k.endsWith(':cursor')?localStorage.getItem(k):JSON.parse(localStorage.getItem('fixture-collection')||'null')||collection])),set:async values=>{for(const [key,value] of Object.entries(values))localStorage.setItem(key,value);}}},downloads:{download(){}}};
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
                <button id="capture">Capture collection</button>
                <button id="append">Remove A and load D</button>
                <button id="upgrade">Upgrade B image</button><pre id="result"></pre>
                <script src="/src/shared/media.js"></script><script src="/src/content_scripts/content.js"></script>
                <script>
                document.getElementById('capture').onclick=()=>collect({action:'startCollection',id:fixtureId},{id:'fixture-extension'},value=>{document.getElementById('result').textContent=JSON.stringify(value,null,2);if(value.data)localStorage.setItem('fixture-collection',JSON.stringify(value.data));});
                document.getElementById('append').onclick=()=>{document.querySelector('img[alt="Artwork A"]')?.remove();if(!document.querySelector('img[alt="Artwork D"]')){const img=document.createElement('img');img.src='/sample-D.svg';img.alt='Artwork D';img.width=120;img.height=120;document.body.insertBefore(img,document.getElementById('capture'));}};
                document.getElementById('upgrade').onclick=()=>{const img=document.querySelector('img[alt="Artwork B"]');if(img.parentElement.tagName!=='A'){const a=document.createElement('a');a.href='/full-B.png';img.replaceWith(a);a.appendChild(img);}};
                </script>'''
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(body.encode());return
        if (route.startswith('/sample-') and route.endswith('.svg')) or route == '/full-B.png':
            letter='B' if route == '/full-B.png' else route[8:-4]
            if letter not in ('A','B','C','D'):self.send_error(404);return
            colors={'A':'#236a76','B':'#684374','C':'#a56832','D':'#326e43'}
            body=f'<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><rect width="900" height="700" fill="{colors[letter]}"/><circle cx="450" cy="350" r="230" fill="#ffffff22"/><text x="450" y="410" text-anchor="middle" font-family="sans-serif" font-size="200" fill="white">{letter}</text></svg>'
            self.send_response(200);self.send_header('Content-Type','image/svg+xml');self.end_headers();self.wfile.write(body.encode());return
        super().do_GET()


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8874)
    ThreadingHTTPServer(('127.0.0.1',parser.parse_args().port),partial(Handler,directory=str(ROOT))).serve_forever()
