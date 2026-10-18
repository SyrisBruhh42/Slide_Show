const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const shared = fs.readFileSync(path.join(root, 'src/shared/media.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'src/content_scripts/content.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function api() { const ctx = vm.createContext({ URL }); vm.runInContext(shared, ctx); return ctx.MediaCollection; }
function element(tag, attrs, w, h) {
    return { tagName: tag.toUpperCase(), currentSrc: attrs.currentSrc || '', parentElement: null,
        getAttribute: key => attrs[key] || null, getBoundingClientRect: () => ({width:w,height:h}),
        closest: selector => selector === 'a[href]' && attrs.anchor ? {getAttribute: () => attrs.anchor} : null,
        querySelectorAll: () => (attrs.sources || []).map(src => ({ getAttribute: () => src })),
        matches: () => false };
}
function collect(elements, request = { action: 'extractMedia' }, sender = { id: 'extension' }) {
    let listener, answer;
    const context = vm.createContext({ URL, location: new URL('https://example.test/feed'),
        document: { querySelectorAll: () => elements }, chrome: { runtime: { id:'extension', onMessage:{ addListener(fn){listener=fn;} } } } });
    vm.runInContext(shared, context); vm.runInContext(content, context);
    listener(request, sender, response => {answer = response;});
    return answer === undefined ? undefined : plain(answer);
}
test('unequal sized gallery keeps page order and retains useful thumbnail', () => {
    const data = collect([element('img',{src:'/road.jpg',class:'thumbnail'},90,90),element('img',{src:'/b.jpg'},500,500),element('img',{src:'/c.jpg'},200,200)]);
    assert.deepEqual(data.galleries.map(x => x.url), ['https://example.test/road.jpg','https://example.test/b.jpg','https://example.test/c.jpg']);
    assert.equal(data.strictProminent[0].url, 'https://example.test/b.jpg');
    assert.equal(JSON.stringify(data).includes('getAttribute'), false);
});
test('selected source, density srcset, query-string full image and video child source', () => {
    const data=collect([element('img',{src:'/fallback.jpg',currentSrc:'https://example.test/chosen.jpg'},100,100),element('img',{src:'/small.jpg',srcset:'/small.jpg 1x, /large.jpg 2x'},100,100),element('img',{src:'/preview.jpg',anchor:'/art.gif?download=1'},100,100),element('video',{sources:['file:///etc/passwd','/clip.mp4']},100,100)]);
    assert.deepEqual(data.mediaList.map(x=>x.url),['https://example.test/chosen.jpg','https://example.test/large.jpg','https://example.test/art.gif?download=1','https://example.test/clip.mp4']);
    assert.equal(data.mediaList[2].type,'gif'); assert.equal(data.mediaList[3].type,'video');
    assert.equal(data.mediaList[1].previewUrl,'https://example.test/small.jpg');
});
test('decorative exclusions use class tokens; duplicates do not reorder feed', () => {
    const data=collect([element('img',{src:'/road.jpg'},100,100),element('img',{src:'/road.jpg'},400,400),element('img',{src:'/face.jpg',class:'user-avatar'},100,100),element('img',{src:'/art.jpg',alt:'A broad landscape'},100,100)]);
    assert.equal(data.mediaList.length,3); assert.deepEqual(data.galleries.map(x=>x.url),['https://example.test/road.jpg','https://example.test/art.jpg']);
});
test('invalid sender and unknown actions cannot start extraction', () => {
    assert.equal(collect([], {action:'extractMedia'}, {id:'other'}),undefined);
    assert.equal(collect([], {action:'unexpected'}),undefined);
});
test('untrusted records are bounded, copied, and reconstructed consistently', () => {
    const m=api(), entry={url:'https://example.test/a.jpg',type:'image',isIgnored:false};
    assert.equal(m.collection({}),null);
    for(const url of ['javascript:void(0)','file:///tmp/photo.jpg','ftp://example.test/a','data:image/svg+xml;base64,PHN2Zz4=','https://name:password@example.test/a']) assert.equal(m.item({...entry,url}),null);
    assert.equal(m.collection({mediaList:Array(2001).fill(entry)}),null);
    assert.equal(m.collection({mediaList:[{...entry,type:'script'}]}),null);
    const result=m.collection({mediaList:[entry],galleries:[{url:'https://wrong.test/x'}],strictProminent:[{...entry,url:'https://wrong.test/x'}]});
    assert.equal(result.galleries[0].url,entry.url); assert.equal(result.strictProminent.length,0);
    assert.equal(m.safeUrl('data:image/png;base64,aGVsbG8='),'data:image/png;base64,aGVsbG8=');
});
test('collector reports truncation and stops at bounded collection size',()=>{
    const result=collect(Array.from({length:2001},(_,i)=>element('img',{src:`/${i}.png`},50,50)));
    assert.equal(result.mediaList.length,2000);assert.equal(result.truncated,true);
});
test('separate launches cannot replace another collection; closing removes only its own session',async()=>{
    const storage={},tabs=[];let click,remove;
    const ctx=vm.createContext({URL,crypto:webcrypto,console,importScripts(){},chrome:{
        action:{onClicked:{addListener(fn){click=fn;}},async setBadgeText(){},async setTitle(){}},
        runtime:{getURL:p=>'chrome-extension://test/'+p},scripting:{async executeScript(){}},
        storage:{session:{async set(values){Object.assign(storage,values);},async get(key){return {[key]:storage[key]};},async remove(keys){for(const key of [].concat(keys))delete storage[key];}}},
        tabs:{async sendMessage(id){return {mediaList:[{url:`https://example.test/${id}.jpg`,type:'image'}]};},async get(id){return tabs.find(t=>t.id===id);},async create(tab){const result={...tab,id:100+tabs.length};tabs.push(result);return result;},onRemoved:{addListener(fn){remove=fn;}}}
    }});
    vm.runInContext(shared,ctx);vm.runInContext(fs.readFileSync(path.join(root,'src/background/background.js'),'utf8'),ctx);
    await Promise.all([click({id:1,url:'https://example.test/a'}),click({id:2,url:'https://example.test/b'})]);
    assert.equal(tabs.length,2);assert.notEqual(tabs[0].url,tabs[1].url);
    const keys=tabs.map(t=>'collection:'+new URL(t.url).searchParams.get('collection'));
    assert.deepEqual(keys.map(k=>storage[k].mediaList[0].url).sort(),['https://example.test/1.jpg','https://example.test/2.jpg']);
    await remove(tabs[0].id);assert.equal(storage[keys[0]],undefined);assert.ok(storage[keys[1]]);
});
test('icons have actual PNG headers and advertised dimensions',()=>{
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
    for(const [size,file] of Object.entries(manifest.icons)){const bytes=fs.readFileSync(path.join(root,file));assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),Number(size));assert.equal(bytes.readUInt32BE(20),Number(size));}
    assert.deepEqual(manifest.permissions,['activeTab','storage','scripting','downloads']);assert.equal(manifest.host_permissions,undefined);
});

test('picture crop with descriptorless source never switches to fallback img art',()=>{
    const image=element('img',{src:'/fallback.jpg',currentSrc:'https://example.test/crop.webp',srcset:'/fallback.jpg 1x, /fallback-large.jpg 2x'},100,100);
    image.closest=selector=>selector==='picture'?{querySelectorAll:()=>[{getAttribute:()=>'/crop.webp'}]}:null;
    assert.equal(collect([image]).mediaList[0].url,'https://example.test/crop.webp');
    image.closest=selector=>selector==='picture'?{querySelectorAll:()=>[{getAttribute:()=>'/unrecognized.webp invalid'}]}:null;
    assert.equal(collect([image]).mediaList[0].url,'https://example.test/crop.webp');
});

test('failed viewer mapping and closure during creation both reclaim their session',async()=>{
    for(const scenario of ['mapping-failure','early-close']) {
        const storage={};let click,remove;
        const ctx=vm.createContext({URL,crypto:webcrypto,console:{error(){}},importScripts(){},chrome:{
            action:{onClicked:{addListener(fn){click=fn;}},async setBadgeText(){},async setTitle(){}},
            runtime:{getURL:p=>'chrome-extension://test/'+p},scripting:{async executeScript(){}},
            storage:{session:{async set(values){if(scenario==='mapping-failure'&&Object.keys(values)[0].startsWith('viewer:'))throw new Error('fixture quota');Object.assign(storage,values);},async get(key){return {[key]:storage[key]};},async remove(keys){for(const k of [].concat(keys))delete storage[k];}}},
            tabs:{async sendMessage(){return {mediaList:[{url:'https://example.test/a.jpg',type:'image'}]};},async create(){if(scenario==='early-close')await remove(100);return {id:100};},async get(){if(scenario==='early-close')throw new Error('No tab');return{id:100};},onRemoved:{addListener(fn){remove=fn;}}}
        }});
        vm.runInContext(shared,ctx);vm.runInContext(fs.readFileSync(path.join(root,'src/background/background.js'),'utf8'),ctx);
        await click({id:1,url:'https://example.test/feed'});
        assert.deepEqual(Object.keys(storage),[],scenario);
    }
});

test('viewer retries preview once, reports failure and ignores stale load handlers',async()=>{
    const nodes=new Map();
    function node(){return {style:{},classList:{add(){},remove(){},toggle(){return true;}},value:'galleries',checked:true,textContent:'',pause(){},play:async()=>{},addEventListener(){},setAttribute(){}};}
    const ctx=vm.createContext({URL,console,Image:class{},clearInterval(){},setInterval(){},document:{addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}},chrome:{storage:{session:{set:async()=>{}}}}});
    vm.runInContext(shared,ctx);vm.runInContext(fs.readFileSync(path.join(root,'src/slideshow/slideshow.js'),'utf8'),ctx);
    await vm.runInContext("state.rawMediaData={}; state.currentPlaylist=[{url:'https://example.test/full.jpg',previewUrl:'https://example.test/preview.jpg',type:'image'},{url:'https://example.test/next.jpg',type:'image'}]; showMedia(0)",ctx);
    const image=nodes.get('current-image'), status=nodes.get('media-status');const oldError=image.onerror;
    image.onerror();assert.equal(image.src,'https://example.test/preview.jpg');assert.match(status.textContent,/page preview/);
    image.onerror();assert.match(status.textContent,/Image unavailable/);
    await vm.runInContext('showMedia(1)',ctx);oldError();assert.equal(image.src,'https://example.test/next.jpg');assert.equal(status.textContent,'');
});
