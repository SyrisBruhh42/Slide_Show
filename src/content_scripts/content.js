/**
 * Media Isolator - Content Extraction Engine
 * Intelligently finds the most prominent media or galleries on the page.
 */

(function() {
    // Prevent re-injection errors
    if (window.hasMediaIsolatorInjected) return;
    window.hasMediaIsolatorInjected = true;

// Heuristics to identify non-content media
const IGNORE_TERMS = ['ad', 'avatar', 'icon', 'banner', 'logo', 'profile', 'thumbnail', 'thumb', 'sprite', 'tracker', 'pixel'];

function shouldIgnoreElement(el) {
    // 1. Size check
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        if (rect.width < 150 || rect.height < 150) {
            return true;
        }
    }

    // 2. Class, ID, and src attribute checks
    const classStr = (el.className || '').toString().toLowerCase();
    const idStr = (el.id || '').toLowerCase();
    const srcStr = (el.src || '').toLowerCase();
    const altStr = (el.alt || '').toLowerCase();

    for (const term of IGNORE_TERMS) {
        if (classStr.includes(term) || idStr.includes(term) || srcStr.includes(term) || altStr.includes(term)) {
            return true;
        }
    }

    // Check closest anchor or figure class/id too
    const parent = el.closest('a, figure, div');
    if (parent) {
        const pClass = (parent.className || '').toString().toLowerCase();
        const pId = (parent.id || '').toLowerCase();
        for (const term of IGNORE_TERMS) {
            if (pClass.includes(term) || pId.includes(term)) {
                return true;
            }
        }
    }

    return false;
}

function getHighestResolutionSource(el) {
    let src = el.src || el.currentSrc;
    let type = el.tagName.toLowerCase() === 'video' ? 'video' : 'image';
    let isGif = src && src.toLowerCase().endsWith('.gif');
    if (isGif) type = 'gif';

    if (type === 'image') {
        // Check for srcset to get the largest image
        if (el.srcset) {
            const sources = el.srcset.split(',').map(s => {
                const parts = s.trim().split(/\s+/);
                const url = parts[0];
                let width = 0;
                if (parts.length > 1 && parts[1].endsWith('w')) {
                    width = parseInt(parts[1].slice(0, -1), 10);
                }
                return { url, width };
            });
            sources.sort((a, b) => b.width - a.width);
            if (sources.length > 0 && sources[0].width > 0) {
                src = sources[0].url;
            }
        }

        // Try finding high res src from parent anchor if it links to an image
        const parentAnchor = el.closest('a');
        if (parentAnchor && parentAnchor.href && /\.(png|jpg|jpeg|webp|gif)$/i.test(parentAnchor.href)) {
            src = parentAnchor.href;
            if (src.toLowerCase().endsWith('.gif')) {
                type = 'gif';
            }
        }
    }

    // Attempt absolute URL resolution
    try {
        src = new URL(src, window.location.href).href;
    } catch (e) {}

    return { url: src, type, el };
}

function extractMedia() {
    const rawElements = Array.from(document.querySelectorAll('img, video'));

    let mediaList = [];
    let strictProminent = null;
    let maxArea = 0;

    for (const el of rawElements) {
        if (!el.src && !el.currentSrc && el.tagName.toLowerCase() !== 'video') {
            const source = el.querySelector('source');
            if (!source || (!source.src && !source.srcset)) {
                continue;
            }
        }

        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        const isIgnored = shouldIgnoreElement(el);

        const mediaData = getHighestResolutionSource(el);

        if (!mediaData.url) continue;

        // "Loose" mode gets everything > 0 size
        if (area > 0) {
            const item = {
                url: mediaData.url,
                type: mediaData.type,
                width: rect.width,
                height: rect.height,
                isIgnored: isIgnored,
                area: area
            };

            // Deduplicate
            if (!mediaList.some(m => m.url === item.url)) {
                mediaList.push(item);
            }
        }
    }

    // Sort media by area, largest first
    mediaList.sort((a, b) => b.area - a.area);

    // Site Specific Extractors
    const hostname = window.location.hostname;

    if (hostname.includes('deviantart.com')) {
        const mainImage = document.querySelector('img[data-hook="art_stage"], img[fetchpriority="high"]');
        if (mainImage) {
             const data = getHighestResolutionSource(mainImage);
             strictProminent = { ...data, isIgnored: false, area: 9999999 };
        }
    } else if (hostname.includes('reddit.com')) {
        // Reddit galleries or single posts
        const postMedia = Array.from(document.querySelectorAll('shreddit-post img, shreddit-post video, [data-test-id="post-content"] img, [data-test-id="post-content"] video'));
        let largestRedditArea = 0;
        for (let m of postMedia) {
            if (shouldIgnoreElement(m)) continue;
            const mData = getHighestResolutionSource(m);
            if (!mData.url) continue;

            const rect = m.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > largestRedditArea) {
                largestRedditArea = area;
                strictProminent = { url: mData.url, type: mData.type, width: rect.width, height: rect.height, isIgnored: false, area: 9999999 };
            }
        }
    } else if (hostname.includes('midjourney.com')) {
        const gridImages = Array.from(document.querySelectorAll('[role="gridcell"] img'));
        let mjLargest = 0;
        for (let m of gridImages) {
             if (shouldIgnoreElement(m)) continue;
             const mData = getHighestResolutionSource(m);
             if (!mData.url) continue;

             const rect = m.getBoundingClientRect();
             const area = rect.width * rect.height;
             if (area > mjLargest) {
                 mjLargest = area;
                 strictProminent = { url: mData.url, type: mData.type, width: rect.width, height: rect.height, isIgnored: false, area: 9999999 };
             }
        }
    } else if (hostname.includes('google.com')) {
         const mainImage = document.querySelector('img[jsname="kn3ccd"]');
         if (mainImage) {
             const data = getHighestResolutionSource(mainImage);
             strictProminent = { ...data, isIgnored: false, area: 9999999 };
         }
    }

    // If we didn't find a strict prominent via site rules, use the largest non-ignored element
    if (!strictProminent) {
        const nonIgnored = mediaList.filter(m => !m.isIgnored);
        if (nonIgnored.length > 0) {
            strictProminent = nonIgnored[0];
        } else if (mediaList.length > 0) {
            strictProminent = mediaList[0];
        }
    }

    const galleries = mediaList.filter(m => !m.isIgnored);

    return {
        mediaList: mediaList, // All media found
        galleries: galleries, // Filtered by heuristics
        strictProminent: strictProminent ? [strictProminent] : []
    };
}

// Receive message from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "extractMedia") {
        const data = extractMedia();
        sendResponse(data);
    }
    return true; // Keep the message channel open for async sendResponse if needed
});

})();
