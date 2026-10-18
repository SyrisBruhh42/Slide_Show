/* Each invocation owns a session so another source tab cannot replace its feed. */
if (typeof importScripts === 'function') importScripts('../shared/media.js');
chrome.action.onClicked.addListener(async tab => {
    if (!Number.isInteger(tab?.id) || !MediaCollection.safeUrl(tab.url, undefined, false)) return;
    let key, viewerKey;
    try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/shared/media.js', 'src/content_scripts/content.js'] });
        const raw = await chrome.tabs.sendMessage(tab.id, { action: 'extractMedia' });
        const data = MediaCollection.collection(raw);
        if (!data) throw new Error('The page returned an invalid media collection.');
        const id = crypto.randomUUID();
        key = 'collection:' + id;
        await chrome.storage.session.set({ [key]: data });
        const viewer = await chrome.tabs.create({ url: chrome.runtime.getURL('src/slideshow/slideshow.html') + '?collection=' + id });
        viewerKey = 'viewer:' + viewer.id;
        await chrome.storage.session.set({ [viewerKey]: key });
        // Closing during tab creation must not leave a retained collection.
        await chrome.tabs.get(viewer.id);
        await chrome.action.setBadgeText({ tabId: tab.id, text: '' }).catch(() => {});
        await chrome.action.setTitle({tabId:tab.id,title:'Extract Media & Start Slideshow'}).catch(() => {});
    } catch (error) {
        if (key) await chrome.storage.session.remove([key, key + ':cursor', ...(viewerKey ? [viewerKey] : [])]).catch(() => {});
        console.error('Media collection could not be opened:', error.message);
        await chrome.action.setBadgeText({ tabId: tab.id, text: '!' }).catch(() => {});
        await chrome.action.setTitle({ tabId: tab.id, title: 'Could not open slideshow. Reload the source page and try again.' }).catch(() => {});
    }
});

chrome.tabs.onRemoved.addListener(async tabId => {
    const mapping = 'viewer:' + tabId;
    try {
        const stored = await chrome.storage.session.get(mapping);
        if (stored[mapping]) await chrome.storage.session.remove([mapping, stored[mapping], stored[mapping] + ':cursor']);
    } catch (error) { console.error('Could not clear the closed collection:', error.message); }
});
