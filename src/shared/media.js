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
            previewUrl: safeUrl(value.previewUrl) || url,
            sourceUrl: safeUrl(value.sourceUrl, undefined, false),
            title: typeof value.title === 'string' ? value.title.slice(0, 500) : '',
            width: dimension(value.width), height: dimension(value.height),
            isIgnored: value.isIgnored === true
        };
    }
    function collection(value) {
        if (!value || typeof value !== 'object' || !Array.isArray(value.mediaList) || value.mediaList.length > MAX_ITEMS) return null;
        const result = [], seen = new Set();
        let bytes = 0;
        for (const raw of value.mediaList) {
            const clean = item(raw);
            if (!clean) return null;
            bytes += clean.url.length + clean.previewUrl.length + clean.sourceUrl.length + clean.title.length + 200;
            if (bytes > 2000000) return null;
            if (!seen.has(clean.url)) { seen.add(clean.url); result.push(clean); }
        }
        const selected = Array.isArray(value.strictProminent) && value.strictProminent.length === 1 ? item(value.strictProminent[0]) : null;
        const prominent = selected && result.find(m => m.url === selected.url);
        return {
            mediaList: result,
            galleries: result.filter(m => !m.isIgnored),
            strictProminent: prominent ? [prominent] : [],
            sourceUrl: safeUrl(value.sourceUrl, undefined, false),
            truncated: value.truncated === true
        };
    }
    root.MediaCollection = Object.freeze({ MAX_ITEMS, safeUrl, item, collection });
})(globalThis);
