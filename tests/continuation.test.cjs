'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const fs = require('node:fs'), path = require('node:path'), {webcrypto:crypto} = require('node:crypto');
const root = path.join(__dirname, '..');
const shared = fs.readFileSync(path.join(root,'src/shared/media.js'),'utf8');
const content = fs.readFileSync(path.join(root,'src/content_scripts/content.js'),'utf8');
const background = fs.readFileSync(path.join(root,'src/background/background.js'),'utf8');
const id = '11111111-1111-1111-1111-111111111111';
const plain = value => JSON.parse(JSON.stringify(value));
function api() { const context=vm.createContext({URL});vm.runInContext(shared,context);return context.MediaCollection; }
function record(id, quality=0, url=`https://images.test/${id}.jpg`) { return {id,quality,url,type:'image',previewUrl:`https://images.test/${id}-thumb.jpg`}; }
function data(items) { return {mediaList:items,sourceUrl:'https://example.test/feed'}; }

test('virtualized removals and reordering cannot replace the remembered curated sequence',()=>{
    const m=api();let old=m.collection(data([record('a'),record('b'),record('c')]));
    old=m.merge(old,data([record('c'),record('b'),record('d')]));
    old=m.merge(old,data([record('b',2,'https://images.test/b-full.jpg'),record('e')]));
    old=m.merge(old,data([record('b',0),record('a')]));
    assert.deepEqual(Array.from(old.mediaList,x=>x.id),['a','b','c','d','e']);
    assert.equal(old.mediaList[1].url,'https://images.test/b-full.jpg');
    assert.equal(m.merge(old,{...data([]),sourceUrl:'https://example.test/related'}),null);
});
test('buffer item and aggregate URL limits preserve earlier items and report omissions',()=>{
    const m=api();const full=m.collection(data(Array.from({length:2000},(_,i)=>record(String(i)))));
    const merged=m.merge(full,data([record('new')]));assert.equal(merged.mediaList.length,2000);assert.equal(merged.truncated,true);
    const long='https://images.test/'+ 'x'.repeat(60000);
    let capped=m.collection(data([]));
    for(let i=0;i<40;i++) capped=m.merge(capped,data([record(String(i),2,long+i)]));
    assert.ok(capped.mediaList.length<40);assert.equal(capped.truncated,true);assert.equal(capped.mediaList[0].id,'0');
});

function image(name, anchor='') {
    const attrs={src:`https://thumbs.test/${name}.jpg`,alt:name};
    const el={tagName:'IMG',currentSrc:attrs.src,parentElement:null,getAttribute:key=>attrs[key]||null,getBoundingClientRect:()=>({width:200,height:150}),querySelectorAll:()=>[],matches:()=>false};
    el.closest=selector=>selector==='a[href]'&&anchor?{getAttribute:()=>anchor}:null;
    return el;
}
function collector({google=false,initialUrl}={}) {
    let callback, listener, disconnected=0, pending;
    const location=new URL(initialUrl || (google?'https://www.google.com/search?q=landscape&udm=2':'https://example.test/feed'));
    const list=[], grid={isConnected:true,querySelectorAll:()=>list};
    const document={querySelector:()=>grid,querySelectorAll:()=>list};
    const context=vm.createContext({URL,crypto,location,document,clearTimeout(){pending=null;},setTimeout(fn){pending=fn;return 1;},MutationObserver:class {constructor(fn){callback=fn;}observe(){}disconnect(){disconnected++;}},chrome:{runtime:{id:'extension',onMessage:{addListener(fn){listener=fn;}}}}});
    vm.runInContext(shared,context);vm.runInContext(content,context);
    function send(request) {let value;listener(request,{id:'extension'},result=>value=plain(result));return value;}
    return {list,grid,location,send,mutate(){callback();if(pending){const fn=pending;pending=null;fn();}},get disconnected(){return disconnected;}};
}
test('observer keeps a removed image after a mutation and closes its source session',()=>{
    const c=collector();c.list.push(image('a'),image('b'));const start=c.send({action:'startCollection',id});
    assert.ok(start.documentId);c.list.splice(0,2,image('c'));c.mutate();
    const refreshed=c.send({action:'refreshCollection',id,documentId:start.documentId});
    assert.deepEqual(refreshed.data.mediaList.map(x=>x.title),['a','b','c']);
    c.send({action:'stopCollection',id});assert.equal(c.disconnected,1);
    assert.match(c.send({action:'refreshCollection',id}).details,/no longer available/);
});
test('changed feed or replaced grid fails closed and a wrong document cannot refresh',()=>{
    const c=collector();c.list.push(image('a'));c.send({action:'startCollection',id});
    assert.match(c.send({action:'refreshCollection',id,documentId:'different'}).details,/no longer/);
    c.location.hash='#another-feed';c.list.push(image('related'));
    assert.match(c.send({action:'refreshCollection',id}).details,/source page changed/);
    const g=collector({google:true});g.send({action:'startCollection',id});g.grid.isConnected=false;
    assert.match(g.send({action:'refreshCollection',id}).details,/source page changed/);
});
test('Google cards stay in the original grid while an observed full-image link upgrades in place',()=>{
    const c=collector({google:true});
    function card(name,anchor='') {
        const img=image(name,anchor), icon=image('icon');icon.getBoundingClientRect=()=>({width:16,height:16});
        const card={getAttribute:key=>key==='data-docid'?name:'https://artist.test/'+name,querySelectorAll:()=>[icon,img]};
        const closest=img.closest;img.closest=selector=>selector==='[data-docid][data-lpage]'?card:closest(selector);
        return card;
    }
    c.list.push(card('a'),card('b'));c.send({action:'startCollection',id});
    c.list.splice(0,2,card('b','https://www.google.com/imgres?imgurl=https%3A%2F%2Fimages.test%2Fb-full.jpg'),card('c'));
    c.location.hash='#imgrc=preview';c.mutate();
    const result=c.send({action:'refreshCollection',id}).data;
    assert.deepEqual(result.mediaList.map(x=>x.id),['google:a','google:b','google:c']);
    assert.equal(result.mediaList[1].url,'https://images.test/b-full.jpg');
    assert.equal(result.mediaList[1].sourceUrl,'https://artist.test/b');
});
test('too many concurrent sessions refuse without replacing an existing session',()=>{
    const c=collector();for(let i=0;i<4;i++) assert.ok(c.send({action:'startCollection',id:id.replace(/^1/,String(i))}).data);
    assert.match(c.send({action:'startCollection',id:'99999999-1111-1111-1111-111111111111'}).details,/Close an existing/);
});

function worker() {
    const storage={},tabs=[];let click,remove,message,gate=null,failWrite=false,failRemove=false,stops=0;
    const source={data:data([record('a')]),documentId:'doc1',sourceKey:'https://example.test/feed'};
    const ctx=vm.createContext({URL,crypto,console:{error(){}},importScripts(){},chrome:{
        action:{onClicked:{addListener(fn){click=fn;}},async setBadgeText(){},async setTitle(){}},
        runtime:{id:'extension',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener(fn){message=fn;}}},scripting:{async executeScript(){}},
        storage:{session:{async get(keys){return Object.fromEntries([].concat(keys).map(k=>[k,storage[k]]));},async set(values){if(failWrite)throw new Error('quota exceeded');Object.assign(storage,values);},async remove(keys){if(failRemove)throw new Error('remove denied');for(const key of [].concat(keys))delete storage[key];}}},
        tabs:{async sendMessage(tabId,request){if(request.action==='stopCollection'){stops++;return{stopped:true};}if(gate)await gate;return plain(source);},async get(){return{id:100};},async create(tab){const value={...tab,id:100};tabs.push(value);return value;},onRemoved:{addListener(fn){remove=fn;}}}
    }});vm.runInContext(shared,ctx);vm.runInContext(background,ctx);
    return {storage,source,tabs,click,remove,get key(){return 'collection:'+new URL(tabs[0].url).searchParams.get('collection');},hold(p){gate=p;},fail(){failWrite=true;},failRemoval(){failRemove=true;},get stops(){return stops;},refresh(overrides={}){return new Promise(resolve=>{const collection=new URL(tabs[0].url).searchParams.get('collection');const accepted=message({action:'refreshCollection',id:collection},{id:'extension',tab:{id:100},url:tabs[0].url,...overrides},resolve);if(!accepted)resolve(undefined);});}};
}
test('only the owning viewer can refresh and a changed source cannot overwrite its saved collection',async()=>{
    const w=worker();await w.click({id:1,url:'https://example.test/feed'});
    assert.equal(await w.refresh({id:'other'}),undefined);assert.equal(await w.refresh({url:'https://example.test/'}),undefined);
    assert.match((await w.refresh({tab:{id:101}})).error,/does not own/);
    w.source.documentId='doc2';w.source.data=data([record('wrong')]);
    assert.match((await w.refresh()).error,/source page changed/);
    assert.equal(w.storage[w.key].mediaList[0].id,'a');
});
test('storage failure leaves original collection and a late refresh cannot resurrect a closed viewer',async()=>{
    const w=worker();await w.click({id:1,url:'https://example.test/feed'});w.source.data=data([record('a'),record('b')]);w.fail();
    assert.match((await w.refresh()).error,/quota/);assert.equal(w.storage[w.key].mediaList.length,1);
    const r=worker();await r.click({id:1,url:'https://example.test/feed'});let release;r.hold(new Promise(resolve=>release=resolve));
    const response=r.refresh();await new Promise(resolve=>setImmediate(resolve));await r.remove(100);release();
    assert.match((await response).error,/closed/);assert.deepEqual(Object.keys(r.storage),[]);
});

test('viewer keeps stable selected item when its URL upgrades during continuation',async()=>{
    const nodes=new Map();const node=()=>({style:{},classList:{add(){},remove(){},toggle(){return true;}},value:'galleries',checked:true,textContent:'',pause(){},play:async()=>{},addEventListener(){},setAttribute(){}});
    const ctx=vm.createContext({URL,console,Image:class{},clearInterval(){},setInterval(){},document:{addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}},chrome:{storage:{session:{set:async()=>{}}}}});
    vm.runInContext(shared,ctx);vm.runInContext(fs.readFileSync(path.join(root,'src/slideshow/slideshow.js'),'utf8'),ctx);
    ctx.first=data([record('a'),record('b')]);ctx.next=data([record('a'),record('b',2,'https://images.test/full-b.jpg'),record('c')]);
    vm.runInContext('state.setMediaData(MediaCollection.collection(first)); buildPlaylist(); showMedia(1); state.setMediaData(MediaCollection.collection(next)); buildPlaylist();',ctx);
    assert.equal(nodes.get('current-image').src,'https://images.test/full-b.jpg');assert.equal(nodes.get('position').textContent,'2 / 3');
});

test('distinct originals sharing a placeholder survive; changed thumbnails do not duplicate a known original',()=>{
    const c=collector();c.list.push(image('placeholder','https://images.test/a.jpg'),image('placeholder','https://images.test/b.jpg'));
    const first=c.send({action:'startCollection',id});assert.deepEqual(first.data.mediaList.map(m=>m.url),['https://images.test/a.jpg','https://images.test/b.jpg']);
    c.list.splice(0,2,image('new-preview','https://images.test/a.jpg'));c.mutate();
    const next=c.send({action:'refreshCollection',id});assert.equal(next.data.mediaList.length,2);
});
test('preview upgraded to known original keeps its prior identity even for long URLs',()=>{
    const m=api(),thumb='https://images.test/'+ 'a'.repeat(1000);
    let current=m.collection(data([{url:thumb,type:'image',previewUrl:thumb}]));
    current=m.merge(current,data([{id:'https://images.test/full.jpg',url:'https://images.test/full.jpg',previewUrl:thumb,type:'image',quality:2}]));
    assert.equal(current.mediaList[0].id,thumb);assert.equal(current.mediaList[0].url,'https://images.test/full.jpg');
    current=m.merge(current,data([{id:'https://images.test/full.jpg',url:'https://images.test/full.jpg',previewUrl:'https://images.test/new-preview.jpg',type:'image',quality:2}]));
    assert.equal(current.mediaList.length,1);
});

test('storage cleanup failure still disconnects the known source observer',async()=>{
    const w=worker();await w.click({id:1,url:'https://example.test/feed'});w.failRemoval();
    await w.remove(100);assert.equal(w.stops,1);assert.ok(w.storage[w.key]);
});
test('Google nested image selection shares the scan budget and reports the unvisited tail',()=>{
    const c=collector({google:true});let reads=0;
    const img=image('same');img.getBoundingClientRect=()=>{reads++;return{width:200,height:150};};
    const card={getAttribute:key=>key==='data-docid'?'same':'https://artist.test/same',querySelectorAll:()=>Array(50).fill(img)};
    c.list.push(...Array(10001).fill(card));
    const result=c.send({action:'extractMedia'});
    assert.ok(reads<=10000);assert.equal(result.truncated,true);assert.equal(result.mediaList.length,1);
});

test('new collection re-evaluates a same-document transition into Google Images',()=>{
    const c=collector({initialUrl:'https://www.google.com/search?q=art'});
    c.location.search='?q=art&udm=2';const img=image('original');
    c.list.push({getAttribute:key=>key==='data-docid'?'original':'https://artist.test/original',querySelectorAll:()=>[img]});
    const result=c.send({action:'startCollection',id});
    assert.equal(result.data.mediaList.length,1);assert.equal(result.data.mediaList[0].id,'google:original');
});
