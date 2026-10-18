/* Each invocation owns a session so another source tab cannot replace its feed. */
if (typeof importScripts === 'function') importScripts('../shared/media.js');
chrome.action.onClicked.addListener(async tab => {
    if (!Number.isInteger(tab?.id) || !MediaCollection.safeUrl(tab.url, undefined, false)) return;
    const id = crypto.randomUUID();
    let key, viewerKey;
    try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/shared/media.js', 'src/content_scripts/content.js'] });
        const raw = await chrome.tabs.sendMessage(tab.id, { action: 'startCollection', id });
        const data = MediaCollection.collection(raw?.data);
        if (!data) throw new Error('The page returned an invalid media collection.');
        if (typeof raw.documentId !== 'string' || raw.sourceKey !== data.sourceUrl) throw new Error('The source identity is invalid.');
        key = 'collection:' + id;
        await chrome.storage.session.set({ [key]: data, [key + ':source']: {tabId:tab.id, documentId:raw.documentId, sourceKey:raw.sourceKey} });
        const viewer = await chrome.tabs.create({ url: chrome.runtime.getURL('src/slideshow/slideshow.html') + '?collection=' + id });
        viewerKey = 'viewer:' + viewer.id;
        await chrome.storage.session.set({ [viewerKey]: key });
        // Closing during tab creation must not leave a retained collection.
        await chrome.tabs.get(viewer.id);
        await chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
        await chrome.action.setTitle({tabId:tab.id,title:'Extract Media & Start Slideshow'}).catch(() => {});
    } catch (error) {
        await chrome.tabs.sendMessage(tab.id, {action:'stopCollection', id}).catch(() => {});
        if (key) await chrome.storage.session.remove([key, key + ':cursor', key + ':source', ...(viewerKey ? [viewerKey] : [])]).catch(() => {});
        console.error('Media collection could not be opened:', error.message);
        await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
        await chrome.action.setTitle({ tabId: tab.id, title: 'Could not open slideshow. Reload the source page and try again.' }).catch(() => {});
    }
});

const refreshing = new Set();
chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request?.action !== 'refreshCollection' || sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !/^[a-f0-9-]{36}$/i.test(request.id || '')) return false;
    const expected = chrome.runtime.getURL('src/slideshow/slideshow.html') + '?collection=' + request.id;
    if (sender.url !== expected) return false;
    const key = 'collection:' + request.id;
    if (refreshing.has(key)) { respond({error:'Collection update already in progress.'}); return false; }
    refreshing.add(key);
    (async () => {
        const mapping = 'viewer:' + sender.tab.id;
        const stored = await chrome.storage.session.get([mapping, key + ':source']);
        if (stored[mapping] !== key) throw new Error('This viewer does not own the collection.');
        const source = stored[key + ':source'];
        if (!source) throw new Error('The source session expired. Open a new collection.');
        const raw = await chrome.tabs.sendMessage(source.tabId, {action:'refreshCollection', id:request.id, documentId:source.documentId});
        if (raw?.error) throw new Error(raw.details || raw.error);
        const data = MediaCollection.collection(raw?.data);
        if (!data || raw.documentId !== source.documentId || raw.sourceKey !== source.sourceKey || data.sourceUrl !== source.sourceKey) throw new Error('The original source page changed. Open a new collection.');
        // A closed viewer must not be resurrected by a late source reply.
        if ((await chrome.storage.session.get(mapping))[mapping] !== key) throw new Error('The collection was closed.');
        await chrome.storage.session.set({[key]:data});
        // Reconcile closure during the storage operation as well.
        if ((await chrome.storage.session.get(mapping))[mapping] !== key) { await chrome.storage.session.remove(key); throw new Error('The collection was closed.'); }
        return {data};
    })().catch(error => ({error:error.message})).then(reply => { refreshing.delete(key); respond(reply); });
    return true;
});

chrome.tabs.onRemoved.addListener(async tabId => {
    const mapping = 'viewer:' + tabId;
    try {
        const stored = await chrome.storage.session.get(mapping);
        const key = stored[mapping];
        if (key) {
            const origin = (await chrome.storage.session.get(key + ':source'))[key + ':source'];
            try { await chrome.storage.session.remove([mapping, key, key + ':cursor', key + ':source']); }
            finally { if (origin) await chrome.tabs.sendMessage(origin.tabId, {action:'stopCollection', id:key.slice('collection:'.length)}).catch(() => {}); }
        }
    } catch (error) { console.error('Could not clear the closed collection:', error.message); }
});
