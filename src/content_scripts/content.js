/**
 * Media Isolator - Content Extraction Engine
 * Intelligently finds the most prominent media or galleries on the page.
 */

(function() {
    // --- State Initialization ---
    if (window.hasMediaIsolatorInjected) return;
    window.hasMediaIsolatorInjected = true;

    // --- Configuration & Constants ---
    const MIN_MEDIA_DIMENSION = 150;

    const IGNORE_TERMS = [
        'ad', 'avatar', 'icon', 'banner', 'logo', 'profile',
        'thumbnail', 'thumb', 'sprite', 'tracker', 'pixel'
    ];

    const MEDIA_TYPES = {
        IMAGE: 'image',
        VIDEO: 'video',
        GIF: 'gif'
    };

    const SITE_SELECTORS = {
        DEVIANTART: 'img[data-hook="art_stage"], img[fetchpriority="high"]',
        REDDIT: 'shreddit-post img, shreddit-post video, [data-test-id="post-content"] img, [data-test-id="post-content"] video',
        MIDJOURNEY: '[role="gridcell"] img',
        GOOGLE: 'img[jsname="kn3ccd"]'
    };

    // --- Validation & Schemas ---
    function isValidRequest(request) {
        return request && typeof request === 'object' && typeof request.action === 'string';
    }

    // --- Core Utility Functions ---
    function resolveAbsoluteUrl(src) {
        if (!src) return '';
        try {
            return new URL(src, window.location.href).href;
        } catch (error) {
            // Unparseable URLs are generally invalid resources
            return '';
        }
    }

    function checkTermsInAttributes(el) {
        const attributes = [
            (el.className || '').toString(),
            (el.id || ''),
            (el.src || ''),
            (el.alt || '')
        ].map(attr => attr.toLowerCase());

        return IGNORE_TERMS.some(term =>
            attributes.some(attr => attr.includes(term))
        );
    }

    function isTooSmall(rect) {
        if (rect.width <= 0 || rect.height <= 0) return true;
        return rect.width < MIN_MEDIA_DIMENSION || rect.height < MIN_MEDIA_DIMENSION;
    }

    function shouldIgnoreElement(el) {
        const rect = el.getBoundingClientRect();

        if (isTooSmall(rect)) return true;
        if (checkTermsInAttributes(el)) return true;

        const parentContainer = el.closest('a, figure, div');
        if (parentContainer && checkTermsInAttributes(parentContainer)) {
            return true;
        }

        return false;
    }

    function determineMediaType(src, tagName) {
        if (tagName === 'video') return MEDIA_TYPES.VIDEO;
        if (src && src.toLowerCase().endsWith('.gif')) return MEDIA_TYPES.GIF;
        return MEDIA_TYPES.IMAGE;
    }

    function getSrcsetLargest(srcset) {
        const sources = srcset.split(',').map(s => {
            const parts = s.trim().split(/\s+/);
            const url = parts[0];
            const widthMatch = parts[1] && parts[1].endsWith('w') ? parts[1].slice(0, -1) : '0';
            return { url, width: parseInt(widthMatch, 10) };
        });

        sources.sort((a, b) => b.width - a.width);
        return sources.length > 0 && sources[0].width > 0 ? sources[0].url : null;
    }

    function getAnchorImageSource(el) {
        const parentAnchor = el.closest('a');
        if (parentAnchor && parentAnchor.href && /\.(png|jpg|jpeg|webp|gif)$/i.test(parentAnchor.href)) {
            return parentAnchor.href;
        }
        return null;
    }

    function getHighestResolutionSource(el) {
        let src = el.src || el.currentSrc;
        const tagName = el.tagName.toLowerCase();
        let type = determineMediaType(src, tagName);

        if (type === MEDIA_TYPES.IMAGE) {
            if (el.srcset) {
                const largestSrcset = getSrcsetLargest(el.srcset);
                if (largestSrcset) src = largestSrcset;
            }

            const anchorSrc = getAnchorImageSource(el);
            if (anchorSrc) {
                src = anchorSrc;
                if (src.toLowerCase().endsWith('.gif')) type = MEDIA_TYPES.GIF;
            }
        }

        const absoluteUrl = resolveAbsoluteUrl(src);
        return { url: absoluteUrl, type, el };
    }

    function hasValidSource(el) {
        if (el.src || el.currentSrc || el.tagName.toLowerCase() === 'video') return true;
        const source = el.querySelector('source');
        return source && (source.src || source.srcset);
    }

    // --- Site-Specific Extractors ---
    function extractSiteSpecificProminent() {
        const hostname = window.location.hostname;

        if (hostname.includes('deviantart.com')) {
            const el = document.querySelector(SITE_SELECTORS.DEVIANTART);
            return el ? { ...getHighestResolutionSource(el), isIgnored: false, area: Infinity } : null;
        }

        if (hostname.includes('google.com')) {
            const el = document.querySelector(SITE_SELECTORS.GOOGLE);
            return el ? { ...getHighestResolutionSource(el), isIgnored: false, area: Infinity } : null;
        }

        const selectorsMap = {
            'reddit.com': SITE_SELECTORS.REDDIT,
            'midjourney.com': SITE_SELECTORS.MIDJOURNEY
        };

        const targetSelector = Object.keys(selectorsMap).find(host => hostname.includes(host));

        if (targetSelector) {
            const elements = Array.from(document.querySelectorAll(selectorsMap[targetSelector]));
            let largestElement = null;
            let maxArea = 0;

            for (const el of elements) {
                if (shouldIgnoreElement(el)) continue;

                const mediaData = getHighestResolutionSource(el);
                if (!mediaData.url) continue;

                const rect = el.getBoundingClientRect();
                const area = rect.width * rect.height;

                if (area > maxArea) {
                    maxArea = area;
                    largestElement = {
                        url: mediaData.url,
                        type: mediaData.type,
                        width: rect.width,
                        height: rect.height,
                        isIgnored: false,
                        area: Infinity
                    };
                }
            }
            return largestElement;
        }

        return null;
    }

    // --- Main Extraction Orchestrator ---
    function extractMedia() {
        const rawElements = Array.from(document.querySelectorAll('img, video'));
        const mediaListMap = new Map(); // Deduplication using Map

        for (const el of rawElements) {
            if (!hasValidSource(el)) continue;

            const rect = el.getBoundingClientRect();
            const area = rect.width * rect.height;

            if (area <= 0) continue;

            const mediaData = getHighestResolutionSource(el);
            if (!mediaData.url) continue;

            const isIgnored = shouldIgnoreElement(el);

            if (!mediaListMap.has(mediaData.url)) {
                mediaListMap.set(mediaData.url, {
                    url: mediaData.url,
                    type: mediaData.type,
                    width: rect.width,
                    height: rect.height,
                    isIgnored: isIgnored,
                    area: area
                });
            }
        }

        const mediaList = Array.from(mediaListMap.values()).sort((a, b) => b.area - a.area);

        let strictProminent = extractSiteSpecificProminent();

        if (!strictProminent && mediaList.length > 0) {
            const nonIgnored = mediaList.find(m => !m.isIgnored);
            strictProminent = nonIgnored || mediaList[0];
        }

        return {
            mediaList: mediaList,
            galleries: mediaList.filter(m => !m.isIgnored),
            strictProminent: strictProminent ? [strictProminent] : []
        };
    }

    // --- Message Listener ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!isValidRequest(request)) {
            sendResponse({ error: 'Invalid request format' });
            return false;
        }

        if (request.action === "extractMedia") {
            try {
                const data = extractMedia();
                sendResponse(data);
            } catch (error) {
                sendResponse({ error: 'Extraction failed' });
            }
        }

        return false; // Sync response
    });

})();
