/* One bounded media contract shared by the collector, background and viewer. */
(function (root) {
    'use strict';
    const MAX_ITEMS = 2000;
    const MAX_URL = 65536;
    function safeUrl(value, base, allowData = true) {
        if (typeof value !== 'string' || !value || value.length > MAX_URL) return '';
        try {
            const url = new URL(value, base);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
                if (url.username || url.password) return '';
                return url.href;
            }
            if (allowData && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
        } catch (_) { /* Invalid source is omitted, never interpreted. */ }
        return '';
    }
    function item(value) {
        if (!value || typeof value !== 'object') return null;
        const url = safeUrl(value.url);
        if (!url || !['image', 'gif', 'video'].includes(value.type)) return null;
        const dimension = n => Number.isFinite(n) && n >= 0 && n <= 100000 ? n : 0;
        return {
            url, type: value.type,
            id: typeof value.id === 'string' && value.id.length <= MAX_URL ? value.id : '',
            quality: [0, 1, 2].includes(value.quality) ? value.quality : 0,
            previewUrl: safeUrl(value.previewUrl) || url,
            sourceUrl: safeUrl(value.sourceUrl, undefined, false),
            title: typeof value.title === 'string' ? value.title.slice(0, 500) : '',
            width: dimension(value.width), height: dimension(value.height),
            isIgnored: value.isIgnored === true
        };
    }
    const identity = value => value.id || value.url;
    const size = value => value.url.length + value.previewUrl.length + value.sourceUrl.length + value.title.length + value.id.length + 200;
    function collection(value) {
        if (!value || typeof value !== 'object' || !Array.isArray(value.mediaList) || value.mediaList.length > MAX_ITEMS) return null;
        const result = [], seen = new Set();
        let bytes = 0;
        for (const raw of value.mediaList) {
            const clean = item(raw);
            if (!clean) return null;
            bytes += size(clean);
            if (bytes > 2000000) return null;
            if (!seen.has(identity(clean))) { seen.add(identity(clean)); result.push(clean); }
        }
        const selected = Array.isArray(value.strictProminent) && value.strictProminent.length === 1 ? item(value.strictProminent[0]) : null;
        const prominent = selected && result.find(m => identity(m) === identity(selected));
        return {
            mediaList: result,
            galleries: result.filter(m => !m.isIgnored),
            strictProminent: prominent ? [prominent] : [],
            sourceUrl: safeUrl(value.sourceUrl, undefined, false),
            truncated: value.truncated === true
        };
    }
    // Append by first observation, never by current DOM position or image size.
    // Virtualized removals do not erase remembered entries. Better known sources
    // replace the record in place without changing the viewer's stable cursor.
    function merge(previous, incoming) {
        const a = collection(previous), b = collection(incoming);
        if (!a || !b || a.sourceUrl !== b.sourceUrl) return null;
        const list = a.mediaList.slice(), positions = new Map(list.map((m, i) => [identity(m), i]));
        const originals = new Map(), previews = new Map();
        function indexAliases(m, i) {
            if (m.id.startsWith('google:')) return;
            if (m.quality === 2) originals.set(m.url, i);
            else if (!previews.has(m.previewUrl)) previews.set(m.previewUrl, i);
        }
        list.forEach(indexAliases);
        let bytes = list.reduce((sum, m) => sum + size(m), 0), truncated = a.truncated || b.truncated;
        for (const next of b.mediaList) {
            let index = positions.get(identity(next));
            if (index === undefined && next.quality === 2 && !next.id.startsWith('google:')) {
                index = originals.get(next.url);
                const previewIndex = previews.get(next.previewUrl);
                if (index === undefined && previewIndex !== undefined && list[previewIndex].quality < 2) index = previewIndex;
            }
            if (index !== undefined) {
                const old = list[index];
                if (next.quality <= old.quality) continue;
                const upgraded = {...next, id:identity(old)};
                const total = bytes - size(old) + size(upgraded);
                if (total > 2000000) { truncated = true; continue; }
                list[index] = upgraded; bytes = total; indexAliases(upgraded, index);
            } else {
                if (list.length >= MAX_ITEMS || bytes + size(next) > 2000000) { truncated = true; continue; }
                positions.set(identity(next), list.length); indexAliases(next, list.length); list.push(next); bytes += size(next);
            }
        }
        return collection({mediaList:list, strictProminent:a.strictProminent, sourceUrl:a.sourceUrl, truncated});
    }
    root.MediaCollection = Object.freeze({ MAX_ITEMS, safeUrl, item, collection, identity, merge });
})(globalThis);
