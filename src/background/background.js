/**
 * Media Isolator - Background Service Worker
 * Handles extension icon clicks and orchestrates data transfer between content scripts and the slideshow UI.
 * Follows Newspaper Topology: High-level orchestration at the top, utilities at the bottom.
 */

// --- High-Level Orchestration ---
chrome.action.onClicked.addListener(handleIconClick);

async function handleIconClick(tab) {
    if (isRestrictedUrl(tab.url)) {
        logger.warn('Cannot inject content script into privileged or invalid pages.', { isPrivileged: true });
        return;
    }

    try {
        await injectContentScript(tab.id);

        const mediaData = await extractMediaFromTab(tab.id);
        validateExtractedData(mediaData);

        await setStorageData({ extractedMediaData: mediaData });

        await openSlideshowTab();

        logger.info('Successfully extracted media and launched slideshow.', { tabId: tab.id });
    } catch (error) {
        logger.error('Failed to process media extraction.', {
            name: error.name,
            message: error.message,
            context: error.context || {}
        });
    }
}

// --- Mid-Level Functions ---
async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: [FILE_PATHS.CONTENT_SCRIPT]
        });
    } catch (error) {
        logger.info('Script injection note (possibly already injected)', { tabId, error: error.message });
    }
}

async function extractMediaFromTab(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { action: ACTIONS.EXTRACT_MEDIA }, (response) => {
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

async function setStorageData(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
                return reject(new StorageError('Failed to save to local storage', { details: chrome.runtime.lastError.message }));
            }
            resolve();
        });
    });
}

async function openSlideshowTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.create({ url: chrome.runtime.getURL(FILE_PATHS.SLIDESHOW_HTML) }, (tab) => {
             if (chrome.runtime.lastError) {
                return reject(new CommunicationError('Failed to open slideshow tab', { details: chrome.runtime.lastError.message }));
            }
            resolve(tab);
        });
    });
}


// --- Low-Level Utilities & Validation ---
function isRestrictedUrl(url) {
    if (!url) return true;
    try {
        const parsedUrl = new URL(url);
        return RESTRICTED_SCHEMES.includes(parsedUrl.protocol);
    } catch (err) {
        return true;
    }
}

function validateExtractedData(data) {
    if (!data || typeof data !== 'object') {
        throw new ValidationError('Invalid data format received from content script.');
    }
    // Ensures boundaries are met before storing.
}

// --- Constants & Types ---
const LOG_LEVELS = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

const RESTRICTED_SCHEMES = [
    'chrome:', 'edge:', 'about:', 'moz-extension:', 'chrome-extension:'
];

const FILE_PATHS = {
    CONTENT_SCRIPT: 'src/content_scripts/content.js',
    SLIDESHOW_HTML: 'src/slideshow/slideshow.html'
};

const ACTIONS = {
    EXTRACT_MEDIA: 'extractMedia'
};

// --- Structured Logger ---
const logger = {
    log: (level, message, context = {}) => {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            ...context
        };
        const consoleMethod = level === LOG_LEVELS.ERROR ? 'error' : (level === LOG_LEVELS.WARN ? 'warn' : 'log');
        console[consoleMethod](JSON.stringify(logEntry));
    },
    info: (message, context) => logger.log(LOG_LEVELS.INFO, message, context),
    warn: (message, context) => logger.log(LOG_LEVELS.WARN, message, context),
    error: (message, context) => logger.log(LOG_LEVELS.ERROR, message, context),
};

// --- Custom Domain Errors ---
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

class StorageError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'StorageError';
        this.context = context;
    }
}

class ValidationError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'ValidationError';
        this.context = context;
    }
}
