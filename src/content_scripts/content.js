/* Capture the loaded collection in page order. Enlarging never changes its source. */
(function () {
    'use strict';
    if (globalThis.hasMediaIsolatorInjected) return;
    globalThis.hasMediaIsolatorInjected = true;
    const media = globalThis.MediaCollection;
    chrome.runtime.onMessage.addListener((request, sender, respond) => {
        if (sender.id !== chrome.runtime.id || request?.action !== 'extractMedia') return false;
        try { respond(extractMedia()); }
        catch (error) { respond({ error: 'Extraction failed', details: error.message }); }
        return false;
    });

    function source(el) {
        const video = el.tagName === 'VIDEO';
        let selected = media.safeUrl(el.currentSrc || el.getAttribute('src'), location.href);
        const preview = selected;
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
            if (choices.length) selected = choices.reduce((a, b) => b.size > a.size ? b : a).url;
            const anchor = el.closest('a[href]');
            const href = anchor && media.safeUrl(anchor.getAttribute('href'), location.href, false);
            if (href && /\.(?:png|jpe?g|webp|gif|avif)$/i.test(new URL(href).pathname)) selected = href;
        }
        if (!selected) return null;
        return {
            url: selected, previewUrl: preview || selected,
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
    function extractMedia() {
        const mediaList = [], seen = new Set();
        const elements = document.querySelectorAll('img, video');
        let prominent = null, preferred = null, maxArea = -1, visited = 0, truncated = false;
        const host = location.hostname;
        const isHost = name => host === name || host.endsWith('.' + name);
        const selector = isHost('deviantart.com') ? 'img[data-hook="art_stage"], img[fetchpriority="high"]' : isHost('google.com') ? 'img[jsname="kn3ccd"]' : isHost('reddit.com') ? 'shreddit-post img, shreddit-post video, [data-test-id="post-content"] img, [data-test-id="post-content"] video' : isHost('midjourney.com') ? '[role="gridcell"] img' : '';
        for (const el of elements) {
            if (++visited > 10000 || mediaList.length >= media.MAX_ITEMS) { truncated = true; break; }
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const found = source(el);
            if (!found || seen.has(found.url)) continue;
            const entry = {
                ...found, width: rect.width, height: rect.height,
                isIgnored: ignored(el, rect), sourceUrl: location.href,
                title: el.getAttribute('alt') || el.getAttribute('title') || ''
            };
            seen.add(found.url); mediaList.push(entry);
            if (selector && el.matches(selector) && !entry.isIgnored && (!preferred || rect.width * rect.height > preferred.width * preferred.height)) preferred = entry;
            if (!entry.isIgnored && rect.width * rect.height > maxArea) {
                maxArea = rect.width * rect.height; prominent = entry;
            }
        }
        return { mediaList, galleries: mediaList.filter(m => !m.isIgnored), strictProminent: preferred ? [preferred] : prominent ? [prominent] : [], sourceUrl: location.href, truncated };
    }
})();
