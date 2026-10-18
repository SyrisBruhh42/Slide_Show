/**
 * Media Isolator - Slideshow Viewer
 * Displays extracted media, handles playback controls, and manages settings.
 * Follows Newspaper Topology.
 */

// --- High-Level Initialization & Orchestration ---
document.addEventListener('DOMContentLoaded', initializeSlideshow);

async function initializeSlideshow() {
    setupEventListeners();
    try {
        const settings = await chrome.storage.local.get(['keybinds']);
        state.updateKeybinds(settings.keybinds);
        updateKeybindUI();
        const id = new URL(location.href).searchParams.get('collection');
        if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Open a collection from its source page.');
        state.collectionKey = 'collection:' + id;
        const saved = await chrome.storage.session.get([state.collectionKey, state.collectionKey + ':cursor']);
        const data = MediaCollection.collection(saved[state.collectionKey]);
        if (!data) throw new Error('This collection expired. Open it again from the source page.');
        state.setMediaData(data);
        state.savedCursor = saved[state.collectionKey + ':cursor'];
        buildPlaylist();
    } catch (error) {
        showEmptyState();
        elements.emptyMessage.textContent = error.message;
    }
}

function buildPlaylist() {
    if (!state.rawMediaData) return;

    const mode = elements.modeSelect.value;
    const selectedList = state.rawMediaData[mode] || [];

    const allowImage = elements.typeImageCb.checked;
    const allowGif = elements.typeGifCb.checked;
    const allowVideo = elements.typeVideoCb.checked;

    state.currentPlaylist = selectedList.filter(item => {
        if (!item || !item.type) return false;
        if (item.type === MEDIA_TYPES.IMAGE && !allowImage) return false;
        if (item.type === MEDIA_TYPES.GIF && !allowGif) return false;
        if (item.type === MEDIA_TYPES.VIDEO && !allowVideo) return false;
        return true;
    });

    const previousUrl = state.savedCursor || state.currentUrl;
    const previousIndex = state.currentPlaylist.findIndex(m => m.url === previousUrl);
    state.currentIndex = previousIndex < 0 ? 0 : previousIndex;
    state.savedCursor = null;

    if (state.currentPlaylist.length > 0) {
        hideEmptyState();
        showMedia(state.currentIndex);
        if (state.isPlaying) startSlideshow();
    } else {
        stopSlideshow();
        showEmptyState();
    }
}

async function showMedia(index) {
    if (state.currentPlaylist.length === 0) return;

    // Wrap around logic
    if (index >= state.currentPlaylist.length) state.currentIndex = 0;
    else if (index < 0) state.currentIndex = state.currentPlaylist.length - 1;
    else state.currentIndex = index;

    const media = state.currentPlaylist[state.currentIndex];

    if (!media || !media.url) {
        logger.error('Invalid media item in playlist', { index: state.currentIndex });
        return;
    }

    state.currentUrl = media.url;
    elements.position.textContent = `${state.currentIndex + 1} / ${state.currentPlaylist.length}`;
    elements.sourceLink.href = media.sourceUrl || state.rawMediaData.sourceUrl || '#';
    elements.mediaStatus.textContent = state.rawMediaData.truncated ? 'Collection limit reached. Some loaded items were omitted.' : '';
    if (state.collectionKey) chrome.storage.session.set({[state.collectionKey + ':cursor']: media.url}).catch(error => {
        elements.mediaStatus.textContent = 'Could not save position: ' + error.message;
    });
    const generation = ++state.generation;

    // UI Transitions and Loading State
    elements.img.onload = null;
    elements.img.onerror = null;
    elements.video.onloadeddata = null;
    elements.video.onerror = null;
    elements.img.classList.remove('loaded');
    elements.video.classList.remove('loaded');
    elements.spinner.style.display = 'block';

    if (media.type === MEDIA_TYPES.VIDEO) {
        elements.img.style.display = 'none';
        elements.video.style.display = 'block';

        // Wait for video metadata to load before fading in
        elements.video.onloadeddata = () => {
             if (generation !== state.generation) return;
             elements.spinner.style.display = 'none';
             elements.video.classList.add('loaded');
        };

        elements.video.onerror = () => {
            if (generation !== state.generation) return;
            elements.spinner.style.display = 'none';
            elements.mediaStatus.textContent = 'Video unavailable. Open its source or continue to the next item.';
        };
        elements.video.src = media.url;

        try {
            await elements.video.play();
        } catch (error) {
            logger.warn('Video autoplay prevented or failed', { error: error.message, url: media.url });
        }
    } else {
        elements.video.style.display = 'none';
        elements.video.pause();
        elements.img.style.display = 'block';

        // Wait for image to load before fading in
        elements.img.alt = media.title || 'Selected image';
        elements.img.onload = () => {
             if (generation !== state.generation) return;
             elements.spinner.style.display = 'none';
             elements.img.classList.add('loaded');
        };
        let usedPreview = false;
        elements.img.onerror = () => {
             if (generation !== state.generation) return;
             if (!usedPreview && media.previewUrl && media.previewUrl !== media.url) {
                 usedPreview = true;
                 elements.mediaStatus.textContent = 'Full-size image unavailable; showing the page preview.';
                 elements.img.src = media.previewUrl;
                 return;
             }
             elements.spinner.style.display = 'none';
             elements.mediaStatus.textContent = 'Image unavailable. Open its source or continue to the next item.';
        };

        elements.img.src = media.url;
    }

    preloadNextMedia();
}

// --- Playback Controls & Interactivity ---
function startSlideshow() {
    if (state.slideInterval) clearInterval(state.slideInterval);
    state.isPlaying = true;
    elements.playPauseBtn.textContent = ICONS.PAUSE;

    state.slideInterval = setInterval(() => {
        showMedia(state.currentIndex + 1);
    }, state.timerDuration);

    if (elements.autoFullscreen.checked && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            logger.warn(`Error attempting to enable fullscreen: ${err.message}`);
        });
    }
}

function stopSlideshow() {
    if (state.slideInterval) {
        clearInterval(state.slideInterval);
        state.slideInterval = null;
    }
    state.isPlaying = false;
    elements.playPauseBtn.textContent = ICONS.PLAY;
}

function togglePlay() {
    if (state.isPlaying) stopSlideshow();
    else startSlideshow();
}

function nextSlide() {
    stopSlideshow();
    showMedia(state.currentIndex + 1);
}

function prevSlide() {
    stopSlideshow();
    showMedia(state.currentIndex - 1);
}

function downloadCurrent() {
    if (state.currentPlaylist.length === 0) return;

    const media = state.currentPlaylist[state.currentIndex];
    if (media && MediaCollection.safeUrl(media.url)) {
        // AUDIT: Security (Path Traversal/Download Abuse) - Need to validate `media.url` before triggering a download to prevent triggering unintended schemes or downloading local system files if a `file://` URL somehow made it this far.
        chrome.downloads.download({ url: media.url }, (downloadId) => {
            if (chrome.runtime.lastError) {
                logger.error('Download failed', { error: chrome.runtime.lastError.message, url: media.url });
            }
        });
    }
}

// --- UI & Event Setup Utilities ---
function setupEventListeners() {
    elements.sidebar.inert = true;
    elements.sidebarToggle.setAttribute('aria-expanded', 'false');
    elements.playPauseBtn.addEventListener('click', togglePlay);
    elements.fullscreenBtn.addEventListener('click', () => {
        const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        action.catch(error => { elements.mediaStatus.textContent = 'Fullscreen unavailable: ' + error.message; });
    });
    elements.nextBtn.addEventListener('click', nextSlide);
    elements.prevBtn.addEventListener('click', prevSlide);
    elements.sidebarToggle.addEventListener('click', toggleSidebar);
    elements.downloadBtn.addEventListener('click', downloadCurrent);

    elements.modeSelect.addEventListener('change', buildPlaylist);
    elements.typeImageCb.addEventListener('change', buildPlaylist);
    elements.typeGifCb.addEventListener('change', buildPlaylist);
    elements.typeVideoCb.addEventListener('change', buildPlaylist);

    elements.timerInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        val = Math.min(val, 60);
        elements.timerInput.value = val;

        state.timerDuration = Math.max(val * 1000, MIN_TIMER_DURATION_MS);
        if (state.isPlaying) startSlideshow();
    });

    const keybindInputs = document.querySelectorAll('.keybind-input');
    keybindInputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            const action = input.id.replace('key-', '');
            const newKey = e.key;

            if (newKey === 'Escape') {
                input.blur();
                return;
            }

            if (state.keybinds.hasOwnProperty(action)) {
                state.keybinds[action] = newKey === ' ' ? ' ' : newKey;
                input.value = newKey;
                saveKeybinds();
            }
            input.blur();
        });
    });

    document.addEventListener('keydown', handleGlobalKeydown);
}

function toggleSidebar() {
    const open = elements.sidebar.classList.toggle('open');
    elements.sidebar.inert = !open;
    elements.sidebarToggle.setAttribute('aria-expanded', String(open));
}

function handleGlobalKeydown(e) {
    if (e.target.classList.contains('keybind-input')) return;

    const tagName = e.target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') return;

    const key = e.key;
    const isSidebarKey = key === state.keybinds.sidebar ||
                         key === state.keybinds.sidebar.toLowerCase() ||
                         key === state.keybinds.sidebar.toUpperCase();

    if (key === state.keybinds.next) {
        nextSlide();
    } else if (key === state.keybinds.prev) {
        prevSlide();
    } else if (key === state.keybinds.play) {
        e.preventDefault();
        togglePlay();
    } else if (key === state.keybinds.speedup) {
        e.preventDefault();
        const currentVal = parseInt(elements.timerInput.value, 10) || 1;
        elements.timerInput.value = Math.max(1, currentVal - 1);
        elements.timerInput.dispatchEvent(new Event('change'));
    } else if (key === state.keybinds.speeddown) {
        e.preventDefault();
        const currentVal = parseInt(elements.timerInput.value, 10) || 1;
        if (currentVal < 60) {
            elements.timerInput.value = currentVal + 1;
            elements.timerInput.dispatchEvent(new Event('change'));
        }
    } else if (isSidebarKey) {
        toggleSidebar();
    }
}

function updateKeybindUI() {
    const safeSetVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    safeSetVal('key-next', state.keybinds.next);
    safeSetVal('key-prev', state.keybinds.prev);
    safeSetVal('key-play', state.keybinds.play);
    safeSetVal('key-speedup', state.keybinds.speedup);
    safeSetVal('key-speeddown', state.keybinds.speeddown);
    safeSetVal('key-sidebar', state.keybinds.sidebar);
}

function showEmptyState() {
    // AUDIT: Antifragility - If `elements.emptyState` was removed from the DOM dynamically (e.g. by another extension), this will throw and break the entire function. Better to add optional chaining `elements.emptyState?.style...`
    elements.img.style.display = 'none';
    elements.video.pause();
    elements.video.style.display = 'none';
    elements.spinner.style.display = 'none';
    elements.emptyState.style.display = 'block';
}

function hideEmptyState() {
    elements.emptyState.style.display = 'none';
}

// --- Low-Level Data & State Helpers ---
function preloadNextMedia() {
    if (state.currentPlaylist.length <= 1) return;

    const nextIndex = (state.currentIndex + 1) % state.currentPlaylist.length;
    const nextMedia = state.currentPlaylist[nextIndex];

    if (nextMedia && nextMedia.type !== MEDIA_TYPES.VIDEO && nextMedia.url) {
        const preload = new Image();
        preload.src = nextMedia.url;
    }
}

function saveKeybinds() {
    // AUDIT: Scalability & Limits - `chrome.storage.local.set` can hit quota limits if called too rapidly (e.g., holding down a key on a keybind input). Consider debouncing this call.
    chrome.storage.local.set({ keybinds: state.keybinds }, () => {
        if (chrome.runtime.lastError) {
            logger.error('Failed to save keybinds', { error: chrome.runtime.lastError.message });
        }
    });
}

function validateMediaData(data) {
    return MediaCollection.collection(data) !== null;
}

// --- Constants & Config ---
const DEFAULT_TIMER_DURATION_MS = 4000;
const MIN_TIMER_DURATION_MS = 1000;

const ICONS = {
    PLAY: '▶',
    PAUSE: '⏸'
};

const MEDIA_TYPES = {
    IMAGE: 'image',
    VIDEO: 'video',
    GIF: 'gif'
};

const LOG_LEVELS = {
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR'
};

// --- Structured Logger ---
const logger = {
    log: (level, message, context = {}) => {
        const entry = { timestamp: new Date().toISOString(), level, message, ...context };
        const method = level === LOG_LEVELS.ERROR ? 'error' : (level === LOG_LEVELS.WARN ? 'warn' : 'log');
        console[method](JSON.stringify(entry));
    },
    info: (msg, ctx) => logger.log(LOG_LEVELS.INFO, msg, ctx),
    warn: (msg, ctx) => logger.log(LOG_LEVELS.WARN, msg, ctx),
    error: (msg, ctx) => logger.log(LOG_LEVELS.ERROR, msg, ctx)
};

// --- State Management ---
class SlideshowState {
    constructor() {
        this.rawMediaData = null;
        this.generation = 0;
        this.currentUrl = null;
        this.collectionKey = null;
        this.currentPlaylist = [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.slideInterval = null;
        this.timerDuration = DEFAULT_TIMER_DURATION_MS;

        this.keybinds = {
            next: 'ArrowRight',
            prev: 'ArrowLeft',
            play: ' ',
            speedup: 'ArrowUp',
            speeddown: 'ArrowDown',
            sidebar: 's'
        };
    }

    setMediaData(data) {
        this.rawMediaData = data;
    }

    updateKeybinds(newKeybinds) {
        if (newKeybinds && typeof newKeybinds === 'object') {
            for (const action of Object.keys(this.keybinds)) {
                if (typeof newKeybinds[action] === 'string' && newKeybinds[action].length > 0 && newKeybinds[action].length <= 32) this.keybinds[action] = newKeybinds[action];
            }
        }
    }
}

const state = new SlideshowState();

// --- DOM Elements ---
const elements = {
    position: document.getElementById('position'),
    sourceLink: document.getElementById('source-link'),
    mediaStatus: document.getElementById('media-status'),
    emptyMessage: document.getElementById('empty-message'),
    fullscreenBtn: document.getElementById('fullscreen-btn'),
    img: document.getElementById('current-image'),
    video: document.getElementById('current-video'),
    spinner: document.getElementById('loading-spinner'),
    emptyState: document.getElementById('empty-state'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebar: document.getElementById('sidebar'),
    modeSelect: document.getElementById('mode-select'),
    typeImageCb: document.getElementById('type-image'),
    typeGifCb: document.getElementById('type-gif'),
    typeVideoCb: document.getElementById('type-video'),
    timerInput: document.getElementById('timer-input'),
    autoFullscreen: document.getElementById('auto-fullscreen'),
    downloadBtn: document.getElementById('download-current-btn')
};
