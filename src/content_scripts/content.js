/**
 * Media Isolator - Content Extraction Engine
 * Intelligently finds the most prominent media or galleries on the page.
 * Follows Newspaper Topology.
 */

(function() {
    // --- State Initialization & Orchestration ---
    if (window.hasMediaIsolatorInjected) return;
    window.hasMediaIsolatorInjected = true;

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);

    function handleRuntimeMessage(request, sender, sendResponse) {
        if (!isValidRequest(request)) {
            sendResponse({ error: 'Invalid request format' });
            return false;
        }

        if (request.action === ACTIONS.EXTRACT_MEDIA) {
            try {
                const data = extractMedia();
                sendResponse(data);
            } catch (error) {
                sendResponse({ error: 'Extraction failed', details: error.message });
            }
        }

        return false; // Sync response
    }

    // --- Main Extraction Orchestrator ---
    function extractMedia() {
        // AUDIT: Performance & Antifragility - `querySelectorAll('img, video')` on extremely large DOMs (e.g., infinite scrolling pages like Twitter/Reddit) will return thousands of elements and block the main thread. Need a limit (e.g., first 500) or chunked yielding with `requestIdleCallback`.
        const rawElements = Array.from(document.querySelectorAll(TARGET_SELECTORS.ALL_MEDIA));
        const mediaListMap = new Map(); // Deduplication using Map

        for (const el of rawElements) {
            // AUDIT: Security (DOM Clobbering) - Avoid interacting with properties directly off the element if possible, or validate them. An attacker can set `<img id="src">` which clobbers `el.src`. Using `el.getAttribute('src')` is safer against clobbering.
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

    // --- Site-Specific Extractors ---
    function extractSiteSpecificProminent() {
        const hostname = window.location.hostname;

        if (hostname.includes(HOSTNAMES.DEVIANTART)) {
            const el = document.querySelector(SITE_SELECTORS.DEVIANTART);
            return el ? { ...getHighestResolutionSource(el), isIgnored: false, area: Infinity } : null;
        }

        if (hostname.includes(HOSTNAMES.GOOGLE)) {
            const el = document.querySelector(SITE_SELECTORS.GOOGLE);
            return el ? { ...getHighestResolutionSource(el), isIgnored: false, area: Infinity } : null;
        }

        const selectorsMap = {
            [HOSTNAMES.REDDIT]: SITE_SELECTORS.REDDIT,
            [HOSTNAMES.MIDJOURNEY]: SITE_SELECTORS.MIDJOURNEY
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

    // --- Core Utility Functions ---
    function getHighestResolutionSource(el) {
        // AUDIT: Security (DOM Clobbering) - `el.src` and `el.currentSrc` can be clobbered by children or attributes with the same name/id on forms or other complex elements. Use `el.getAttribute('src')` and handle relative paths manually, or safely access properties.
        let src = el.src || el.currentSrc;

        // AUDIT: Antifragility - If `tagName` is clobbered or overridden, `toLowerCase()` will throw. Better to use `Object.prototype.toString.call(el)` or checking `instanceof HTMLImageElement`.
        const tagName = el.tagName.toLowerCase();
        let type = determineMediaType(src, tagName);

        if (type === MEDIA_TYPES.IMAGE) {
            // AUDIT: Security - Clobbering risk on `el.srcset`. Safer: `el.getAttribute('srcset')`.
            if (el.srcset) {
                const largestSrcset = getSrcsetLargest(el.srcset);
                if (largestSrcset) src = largestSrcset;
            }

            const anchorSrc = getAnchorImageSource(el);
            if (anchorSrc) {
                src = anchorSrc;
                if (src.toLowerCase().endsWith(FILE_EXTENSIONS.GIF)) type = MEDIA_TYPES.GIF;
            }
        }

        // AUDIT: Security (SSRF/Protocol) - After resolving absolute URL, must ensure protocol is `http:` or `https:` or `data:`. Do not allow `javascript:` or `file:` URLs to propagate.
        const absoluteUrl = resolveAbsoluteUrl(src);
        return { url: absoluteUrl, type, el };
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

    function hasValidSource(el) {
        if (el.src || el.currentSrc || el.tagName.toLowerCase() === TAGS.VIDEO) return true;
        const source = el.querySelector(TAGS.SOURCE);
        return source && (source.src || source.srcset);
    }

    function determineMediaType(src, tagName) {
        if (tagName === TAGS.VIDEO) return MEDIA_TYPES.VIDEO;
        if (src && src.toLowerCase().endsWith(FILE_EXTENSIONS.GIF)) return MEDIA_TYPES.GIF;
        return MEDIA_TYPES.IMAGE;
    }

    function shouldIgnoreElement(el) {
        const rect = el.getBoundingClientRect();

        if (isTooSmall(rect)) return true;
        if (checkTermsInAttributes(el)) return true;

        const parentContainer = el.closest(TARGET_SELECTORS.PARENT_CONTAINERS);
        if (parentContainer && checkTermsInAttributes(parentContainer)) {
            return true;
        }

        return false;
    }

    function isTooSmall(rect) {
        if (rect.width <= 0 || rect.height <= 0) return true;
        return rect.width < MIN_MEDIA_DIMENSION || rect.height < MIN_MEDIA_DIMENSION;
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

    function resolveAbsoluteUrl(src) {
        if (!src) return '';
        try {
            return new URL(src, window.location.href).href;
        } catch (error) {
            return '';
        }
    }

    // --- Validation & Schemas ---
    function isValidRequest(request) {
        // AUDIT: Security - While this checks the shape, any website can send messages via `window.postMessage` if the background script relays it improperly, or if the content script listens to `window.addEventListener('message')`. (Currently using `chrome.runtime.onMessage` which is safe from page context, but good to strictly validate action values).
        return request !== null && typeof request === 'object' && typeof request.action === 'string';
    }

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

    const FILE_EXTENSIONS = {
        GIF: '.gif'
    };

    const TAGS = {
        VIDEO: 'video',
        SOURCE: 'source'
    };

    const TARGET_SELECTORS = {
        ALL_MEDIA: 'img, video',
        PARENT_CONTAINERS: 'a, figure, div'
    };

    const HOSTNAMES = {
        DEVIANTART: 'deviantart.com',
        GOOGLE: 'google.com',
        REDDIT: 'reddit.com',
        MIDJOURNEY: 'midjourney.com'
    };

    const SITE_SELECTORS = {
        DEVIANTART: 'img[data-hook="art_stage"], img[fetchpriority="high"]',
        REDDIT: 'shreddit-post img, shreddit-post video, [data-test-id="post-content"] img, [data-test-id="post-content"] video',
        MIDJOURNEY: '[role="gridcell"] img',
        GOOGLE: 'img[jsname="kn3ccd"]'
    };

    const ACTIONS = {
        EXTRACT_MEDIA: 'extractMedia'
    };

})();
