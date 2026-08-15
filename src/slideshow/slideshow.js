// --- Constants & Config ---
const DEFAULT_TIMER_DURATION_MS = 4000;
const MIN_TIMER_DURATION_MS = 1000;

const ICONS = {
    PLAY: '▶',
    PAUSE: '⏸'
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
        console[level.toLowerCase() === 'error' ? 'error' : (level.toLowerCase() === 'warn' ? 'warn' : 'log')](JSON.stringify(entry));
    },
    info: (msg, ctx) => logger.log(LOG_LEVELS.INFO, msg, ctx),
    warn: (msg, ctx) => logger.log(LOG_LEVELS.WARN, msg, ctx),
    error: (msg, ctx) => logger.log(LOG_LEVELS.ERROR, msg, ctx)
};

// --- State Management ---
class SlideshowState {
    constructor() {
        this.rawMediaData = null;
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
        if (!data || typeof data !== 'object') {
            logger.error('Invalid media data provided to state');
            this.rawMediaData = {};
            return;
        }
        this.rawMediaData = data;
    }

    updateKeybinds(newKeybinds) {
        if (newKeybinds && typeof newKeybinds === 'object') {
            this.keybinds = { ...this.keybinds, ...newKeybinds };
        }
    }
}

const state = new SlideshowState();

// --- DOM Elements ---
const elements = {
    img: document.getElementById('current-image'),
    video: document.getElementById('current-video'),
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
    downloadBtn: document.getElementById('download-current-btn')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initializeSlideshow);

function initializeSlideshow() {
    chrome.storage.local.get(['extractedMediaData', 'keybinds'], (result) => {
        if (result.keybinds) {
            state.updateKeybinds(result.keybinds);
            updateKeybindUI();
        }

        if (result.extractedMediaData) {
            state.setMediaData(result.extractedMediaData);
            buildPlaylist();
            showMedia(0);
            startSlideshow();
        } else {
            logger.error("No media data found in local storage.");
        }
    });

    setupEventListeners();
}

// --- UI Updates ---
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

function saveKeybinds() {
    chrome.storage.local.set({ keybinds: state.keybinds }, () => {
        if (chrome.runtime.lastError) {
            logger.error('Failed to save keybinds', { error: chrome.runtime.lastError.message });
        }
    });
}

// --- Core Logic ---
function buildPlaylist() {
    if (!state.rawMediaData) return;

    const mode = elements.modeSelect.value;
    const selectedList = state.rawMediaData[mode] || [];

    const allowImage = elements.typeImageCb.checked;
    const allowGif = elements.typeGifCb.checked;
    const allowVideo = elements.typeVideoCb.checked;

    state.currentPlaylist = selectedList.filter(item => {
        if (!item || !item.type) return false;
        if (item.type === 'image' && !allowImage) return false;
        if (item.type === 'gif' && !allowGif) return false;
        if (item.type === 'video' && !allowVideo) return false;
        return true;
    });

    state.currentIndex = 0;

    if (state.currentPlaylist.length > 0) {
        showMedia(state.currentIndex);
    } else {
        elements.img.style.display = 'none';
        elements.video.style.display = 'none';
        logger.info('No media matched the current filter criteria.');
    }
}

async function showMedia(index) {
    if (state.currentPlaylist.length === 0) return;

    if (index >= state.currentPlaylist.length) state.currentIndex = 0;
    else if (index < 0) state.currentIndex = state.currentPlaylist.length - 1;
    else state.currentIndex = index;

    const media = state.currentPlaylist[state.currentIndex];

    if (!media || !media.url) {
        logger.error('Invalid media item in playlist', { index: state.currentIndex });
        return;
    }

    if (media.type === 'video') {
        elements.img.style.display = 'none';
        elements.video.style.display = 'block';
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
        elements.img.src = media.url;
    }

    preloadNextMedia();
}

function preloadNextMedia() {
    if (state.currentPlaylist.length <= 1) return;

    const nextIndex = (state.currentIndex + 1) % state.currentPlaylist.length;
    const nextMedia = state.currentPlaylist[nextIndex];

    if (nextMedia && nextMedia.type !== 'video' && nextMedia.url) {
        const preload = new Image();
        preload.src = nextMedia.url;
    }
}

// --- Playback Controls ---
function startSlideshow() {
    if (state.slideInterval) clearInterval(state.slideInterval);
    state.isPlaying = true;
    elements.playPauseBtn.textContent = ICONS.PAUSE;

    state.slideInterval = setInterval(() => {
        showMedia(state.currentIndex + 1);
    }, state.timerDuration);
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
    if (media && media.url) {
        chrome.downloads.download({ url: media.url }, (downloadId) => {
            if (chrome.runtime.lastError) {
                logger.error('Download failed', { error: chrome.runtime.lastError.message, url: media.url });
            }
        });
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    elements.playPauseBtn.addEventListener('click', togglePlay);
    elements.nextBtn.addEventListener('click', nextSlide);
    elements.prevBtn.addEventListener('click', prevSlide);
    elements.sidebarToggle.addEventListener('click', () => elements.sidebar.classList.toggle('open'));
    elements.downloadBtn.addEventListener('click', downloadCurrent);

    elements.modeSelect.addEventListener('change', buildPlaylist);
    elements.typeImageCb.addEventListener('change', buildPlaylist);
    elements.typeGifCb.addEventListener('change', buildPlaylist);
    elements.typeVideoCb.addEventListener('change', buildPlaylist);

    elements.timerInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;

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
        elements.timerInput.value = currentVal + 1;
        elements.timerInput.dispatchEvent(new Event('change'));
    } else if (key === state.keybinds.speeddown) {
        e.preventDefault();
        const currentVal = parseInt(elements.timerInput.value, 10) || 1;
        if (currentVal > 1) {
            elements.timerInput.value = currentVal - 1;
            elements.timerInput.dispatchEvent(new Event('change'));
        }
    } else if (isSidebarKey) {
        elements.sidebar.classList.toggle('open');
    }
}
