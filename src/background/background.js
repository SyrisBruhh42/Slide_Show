/**
 * Media Isolator - Background Service Worker
 * Handles extension icon clicks and orchestrates data transfer between content scripts and the slideshow UI.
 */

// --- Constants & Types ---
const LOG_LEVELS = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

const RESTRICTED_SCHEMES = ['chrome:', 'edge:', 'about:', 'moz-extension:', 'chrome-extension:'];

// --- Domain Errors ---
class CommunicationError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'CommunicationError';
        this.context = context;
    }
}

class ScriptInjectionError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'ScriptInjectionError';
        this.context = context;
    }
}

// --- Utilities ---
const logger = {
    log: (level, message, context = {}) => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...context
        };
        console[level.toLowerCase() === 'error' ? 'error' : (level.toLowerCase() === 'warn' ? 'warn' : 'log')](JSON.stringify(logEntry));
    },
    info: (message, context) => logger.log(LOG_LEVELS.INFO, message, context),
    warn: (message, context) => logger.log(LOG_LEVELS.WARN, message, context),
    error: (message, context) => logger.log(LOG_LEVELS.ERROR, message, context),
};

function isRestrictedUrl(url) {
    if (!url) return true;
    try {
        const parsedUrl = new URL(url);
        return RESTRICTED_SCHEMES.includes(parsedUrl.protocol);
    } catch (err) {
        return true; // Invalid URLs are treated as restricted
    }
}

async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/content_scripts/content.js']
        });
    } catch (error) {
        // We log it, but it's not necessarily fatal if it was already injected.
        logger.info('Script injection note (possibly already injected)', { tabId, error: error.message });
    }
}

async function extractMediaFromTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: 'extractMedia' }, (response) => {
            if (chrome.runtime.lastError) {
                return reject(new CommunicationError('Error communicating with content script', {
                    details: chrome.runtime.lastError.message
                }));
            }
            if (!response) {
                return reject(new CommunicationError('No response received from content script', { tabId }));
            }
            resolve(response);
        });
    });
}

// --- Core Logic ---
async function handleIconClick(tab) {
    if (isRestrictedUrl(tab.url)) {
        logger.warn('Cannot inject content script into privileged or invalid pages.', { isPrivileged: true });
        return;
    }

    try {
        await injectContentScript(tab.id);

        const mediaData = await extractMediaFromTab(tab.id);

        await chrome.storage.local.set({ extractedMediaData: mediaData });

        await chrome.tabs.create({ url: chrome.runtime.getURL('src/slideshow/slideshow.html') });

        logger.info('Successfully extracted media and launched slideshow.', { tabId: tab.id });
    } catch (error) {
        logger.error('Failed to process media extraction.', {
            name: error.name,
            message: error.message,
            context: error.context
        });
    }
}

// --- Event Listeners ---
chrome.action.onClicked.addListener(handleIconClick);
