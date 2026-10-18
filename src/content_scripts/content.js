/* Capture the loaded collection in page order. Enlarging never changes its source. */
(function () {
    'use strict';
    if (globalThis.hasMediaIsolatorInjected) return;
    globalThis.hasMediaIsolatorInjected = true;
    const media = globalThis.MediaCollection;
    const sessions = new Map();
    const documentId = crypto.randomUUID();
    const google = location.hostname === 'google.com' || location.hostname.endsWith('.google.com');
    function googleImages() {
        const url = new URL(location.href);
        return google && url.pathname === '/search' && (url.searchParams.get('udm') === '2' || url.searchParams.get('tbm') === 'isch');
    }
    function sourceKey() {
        const url = new URL(location.href);
        if (googleImages()) url.hash = ''; // Google enlargement changes only its preview fragment.
        return url.href;
    }
    function boundary() {
        if (googleImages()) {
            const root = document.querySelector('#rso');
            if (!root) throw new Error('The original Google Images grid is unavailable.');
            return root;
        }
        return document;
    }
    function stop(id) {
        const session = sessions.get(id);
        if (session) { session.observer.disconnect(); clearTimeout(session.timer); sessions.delete(id); }
    }
    function capture(session) {
        if (sourceKey() !== session.sourceKey || (session.root !== document && !session.root.isConnected)) {
            session.error = 'The source page changed. Open a new collection from that page.';
            session.observer.disconnect();
            return;
        }
        const next = extractMedia(session.root, session.sourceKey);
        const merged = media.merge(session.data, next);
        if (!merged) { session.error = 'The page collection exceeds supported limits.'; return; }
        session.data = merged;
    }
    chrome.runtime.onMessage.addListener((request, sender, respond) => {
        if (sender.id !== chrome.runtime.id) return false;
        try {
            if (request?.action === 'extractMedia') { respond(extractMedia(boundary(), sourceKey())); return false; }
            if (!/^[a-f0-9-]{36}$/i.test(request?.id || '')) return false;
            if (request.action === 'stopCollection') { stop(request.id); respond({stopped:true}); return false; }
            if (request.action === 'startCollection') {
                if (sessions.has(request.id) || sessions.size >= 4) throw new Error('Close an existing slideshow before opening another from this page.');
                const root = boundary(), key = sourceKey();
                const session = {root, sourceKey:key, data:media.collection(extractMedia(root, key)), timer:null};
                if (!session.data) throw new Error('The page collection exceeds supported limits.');
                session.observer = new MutationObserver(() => {
                    if (session.timer) return;
                    session.timer = setTimeout(() => { session.timer = null; try { capture(session); } catch (_) { session.error = 'Could not update the source collection.'; } }, 150);
                });
                sessions.set(request.id, session);
                session.observer.observe(root, {subtree:true, childList:true, attributes:true, attributeFilter:['src','srcset','href','data-docid','data-lpage']});
            } else if (request.action !== 'refreshCollection') return false;
            const session = sessions.get(request.id);
            if (!session || (request.documentId && request.documentId !== documentId)) throw new Error('The original source document is no longer available.');
            capture(session);
            if (session.error) throw new Error(session.error);
            respond({data:session.data, documentId, sourceKey:session.sourceKey});
        }
        catch (error) { respond({ error: 'Extraction failed', details: error.message }); }
        return false;
    });

    function source(el) {
        const video = el.tagName === 'VIDEO';
        let selected = media.safeUrl(el.currentSrc || el.getAttribute('src'), location.href);
        const preview = selected;
        let quality = 0;
        if (video && !selected) {
            for (const candidate of el.querySelectorAll('source[src]')) {
                selected = media.safeUrl(candidate.getAttribute('src'), location.href);
                if (selected) break;
            }
        }
        if (!video) {
            // currentSrc already reflects picture/media rules; only compare candidates
            // from its selected picture source, or the image's own srcset.
            let srcset = el.getAttribute('srcset') || '';
            const picture = el.closest('picture');
            if (picture) {
                const fallback = candidates(srcset);
                srcset = fallback.some(c => c.url === selected) ? srcset : '';
                for (const candidate of picture.querySelectorAll('source[srcset]')) {
                    const values = candidates(candidate.getAttribute('srcset'));
                    if (values.some(c => c.url === selected)) { srcset = candidate.getAttribute('srcset'); break; }
                }
            }
            const choices = candidates(srcset);
            if (choices.length) { selected = choices.reduce((a, b) => b.size > a.size ? b : a).url; quality = 1; }
            const anchor = el.closest('a[href]');
            const href = anchor && media.safeUrl(anchor.getAttribute('href'), location.href, false);
            if (href && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(new URL(href).pathname)) { selected = href; quality = 2; }
            if (google && href) {
                const link = new URL(href);
                if (link.origin === location.origin && link.pathname === '/imgres') {
                    const full = media.safeUrl(link.searchParams.get('imgurl'), undefined, false);
                    if (full) { selected = full; quality = 2; }
                }
            }
        }
        if (!selected) return null;
        return {
            url: selected, previewUrl: preview || selected, quality,
            type: video ? 'video' : (/\.gif$/i.test(new URL(selected).pathname) || selected.startsWith('data:image/gif;') ? 'gif' : 'image')
        };
    }
    function candidates(srcset) {
        const result = [];
        const single = (srcset || '').trim();
        if (single && !/[\s,]/.test(single)) {
            const url = media.safeUrl(single, location.href);
            return url ? [{url, size:1, kind:'x'}] : [];
        }
        // Invalid/mixed descriptors keep the browser-selected source instead.
        const expression = /(?:^|,\s*)(\S+)\s+(\d+(?:\.\d+)?)(w|x)(?=\s*(?:,|$))/g;
        for (const match of (srcset || '').matchAll(expression)) {
            const url = media.safeUrl(match[1], location.href);
            if (url && Number(match[2]) > 0) result.push({ url, size: Number(match[2]), kind: match[3] });
        }
        return new Set(result.map(c => c.kind)).size > 1 ? [] : result;
    }
    function ignored(el, rect) {
        if (rect.width < 32 || rect.height < 32) return true;
        const blocked = new Set(['ad', 'ads', 'advertisement', 'avatar', 'icon', 'logo', 'sprite', 'tracker']);
        // Filename or prose substrings such as road.jpg are never exclusion rules.
        let node = el;
        for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
            const words = ((node.getAttribute('class') || '') + ' ' + (node.getAttribute('id') || '')).toLowerCase().split(/[^a-z0-9]+/);
            if (words.some(word => blocked.has(word))) return true;
        }
        return false;
    }
    function extractMedia(root, key) {
        const mediaList = [], seen = new Set();
        const cards = google && root !== document ? root.querySelectorAll('[data-docid][data-lpage]') : null;
        let prominent = null, preferred = null, maxArea = -1, visited = 0, truncated = false;
        function* elements() {
            if (!cards) {
                for (const el of root.querySelectorAll('img, video')) {
                    if (++visited > 10000) { truncated = true; return; }
                    yield {el, rect:el.getBoundingClientRect(), card:null};
                }
                return;
            }
            for (const card of cards) {
                if (++visited > 10000) { truncated = true; return; }
                let best = null;
                for (const el of card.querySelectorAll('img')) {
                    if (++visited > 10000) { truncated = true; break; }
                    const rect = el.getBoundingClientRect();
                    if (!best || rect.width * rect.height > best.rect.width * best.rect.height) best = {el, rect, card};
                }
                if (best) yield best;
                if (truncated) return;
            }
        }
        const host = location.hostname;
        const isHost = name => host === name || host.endsWith('.' + name);
        const selector = isHost('deviantart.com') ? 'img[data-hook="art_stage"], img[fetchpriority="high"]' : isHost('google.com') ? 'img[jsname="kn3ccd"]' : isHost('reddit.com') ? 'shreddit-post img, shreddit-post video, [data-test-id="post-content"] img, [data-test-id="post-content"] video' : isHost('midjourney.com') ? '[role="gridcell"] img' : '';
        for (const {el, rect, card} of elements()) {
            if (mediaList.length >= media.MAX_ITEMS) { truncated = true; break; }
            if (rect.width <= 0 || rect.height <= 0) continue;
            const found = source(el);
            if (!found) continue;
            const candidateId = found.quality === 2 ? found.url : found.previewUrl;
            const id = card ? 'google:' + card.getAttribute('data-docid') : candidateId;
            if (seen.has(id || found.url)) continue;
            if (!cards && el.closest('[role="dialog"], [aria-modal="true"]')) continue;
            const entry = {
                ...found, id, width: rect.width, height: rect.height,
                isIgnored: ignored(el, rect), sourceUrl: card ? media.safeUrl(card.getAttribute('data-lpage'), location.href, false) : key,
                title: el.getAttribute('alt') || el.getAttribute('title') || ''
            };
            seen.add(id || found.url); mediaList.push(entry);
            if (selector && el.matches(selector) && !entry.isIgnored && (!preferred || rect.width * rect.height > preferred.width * preferred.height)) preferred = entry;
            if (!entry.isIgnored && rect.width * rect.height > maxArea) {
                maxArea = rect.width * rect.height; prominent = entry;
            }
        }
        return { mediaList, galleries: mediaList.filter(m => !m.isIgnored), strictProminent: preferred ? [preferred] : prominent ? [prominent] : [], sourceUrl:key, truncated };
    }
})();
