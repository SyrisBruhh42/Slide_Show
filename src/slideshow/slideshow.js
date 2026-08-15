// State
let rawMediaData = null;
let currentPlaylist = [];
let currentIndex = 0;
let isPlaying = true;
let slideInterval = null;
let timerDuration = 4000;

// Keybindings State
let keybinds = {
    next: 'ArrowRight',
    prev: 'ArrowLeft',
    play: ' ',
    speedup: 'ArrowUp',
    speeddown: 'ArrowDown',
    sidebar: 's'
};

// DOM Elements
const imgEl = document.getElementById('current-image');
const videoEl = document.getElementById('current-video');
const playPauseBtn = document.getElementById('play-pause-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const modeSelect = document.getElementById('mode-select');
const typeImageCb = document.getElementById('type-image');
const typeGifCb = document.getElementById('type-gif');
const typeVideoCb = document.getElementById('type-video');
const timerInput = document.getElementById('timer-input');
const downloadBtn = document.getElementById('download-current-btn');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Load extracted data and settings from storage
    chrome.storage.local.get(['extractedMediaData', 'keybinds'], (result) => {
        if (result.keybinds) {
            keybinds = { ...keybinds, ...result.keybinds };
            updateKeybindUI();
        }

        if (result.extractedMediaData) {
            rawMediaData = result.extractedMediaData;
            buildPlaylist();
            showMedia(0);
            startSlideshow();
        } else {
            console.error("No media data found.");
        }
    });

    setupEventListeners();
});

function updateKeybindUI() {
    document.getElementById('key-next').value = keybinds.next;
    document.getElementById('key-prev').value = keybinds.prev;
    document.getElementById('key-play').value = keybinds.play;
    document.getElementById('key-speedup').value = keybinds.speedup;
    document.getElementById('key-speeddown').value = keybinds.speeddown;
    document.getElementById('key-sidebar').value = keybinds.sidebar;
}

function saveKeybinds() {
    chrome.storage.local.set({ keybinds: keybinds });
}

// Build Playlist based on settings
function buildPlaylist() {
    if (!rawMediaData) return;

    const mode = modeSelect.value;
    let selectedList = rawMediaData[mode] || [];

    // Filter by type
    const allowImage = typeImageCb.checked;
    const allowGif = typeGifCb.checked;
    const allowVideo = typeVideoCb.checked;

    currentPlaylist = selectedList.filter(item => {
        if (item.type === 'image' && !allowImage) return false;
        if (item.type === 'gif' && !allowGif) return false;
        if (item.type === 'video' && !allowVideo) return false;
        return true;
    });

    currentIndex = 0;
    if (currentPlaylist.length > 0) {
        showMedia(currentIndex);
    } else {
        imgEl.style.display = 'none';
        videoEl.style.display = 'none';
        // Could show a 'No media found for current filters' message here
    }
}

// Display Media
function showMedia(index) {
    if (currentPlaylist.length === 0) return;

    // Wrap around
    if (index >= currentPlaylist.length) currentIndex = 0;
    else if (index < 0) currentIndex = currentPlaylist.length - 1;
    else currentIndex = index;

    const media = currentPlaylist[currentIndex];

    if (media.type === 'video') {
        imgEl.style.display = 'none';
        videoEl.style.display = 'block';
        videoEl.src = media.url;
        videoEl.play().catch(e => console.log("Auto-play prevented"));
    } else {
        videoEl.style.display = 'none';
        videoEl.pause();
        imgEl.style.display = 'block';
        imgEl.src = media.url;
    }

    // Preload next image if possible
    if (currentPlaylist.length > 1) {
        let nextIndex = (currentIndex + 1) % currentPlaylist.length;
        let nextMedia = currentPlaylist[nextIndex];
        if (nextMedia.type !== 'video') {
            const preload = new Image();
            preload.src = nextMedia.url;
        }
    }
}

// Slideshow Controls
function startSlideshow() {
    if (slideInterval) clearInterval(slideInterval);
    isPlaying = true;
    playPauseBtn.innerHTML = '&#10074;&#10074;'; // Pause icon
    slideInterval = setInterval(() => {
        showMedia(currentIndex + 1);
    }, timerDuration);
}

function stopSlideshow() {
    if (slideInterval) clearInterval(slideInterval);
    isPlaying = false;
    playPauseBtn.innerHTML = '&#9654;'; // Play icon
}

function togglePlay() {
    if (isPlaying) stopSlideshow();
    else startSlideshow();
}

function nextSlide() {
    stopSlideshow();
    showMedia(currentIndex + 1);
}

function prevSlide() {
    stopSlideshow();
    showMedia(currentIndex - 1);
}

// Download logic
function downloadCurrent() {
    if (currentPlaylist.length === 0) return;
    const url = currentPlaylist[currentIndex].url;
    chrome.downloads.download({ url: url });
}

// Event Listeners setup
function setupEventListeners() {
    // UI Buttons
    playPauseBtn.addEventListener('click', togglePlay);
    nextBtn.addEventListener('click', nextSlide);
    prevBtn.addEventListener('click', prevSlide);
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    downloadBtn.addEventListener('click', downloadCurrent);

    // Settings changes
    modeSelect.addEventListener('change', buildPlaylist);
    typeImageCb.addEventListener('change', buildPlaylist);
    typeGifCb.addEventListener('change', buildPlaylist);
    typeVideoCb.addEventListener('change', buildPlaylist);

    timerInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (val < 1) val = 1;
        timerDuration = val * 1000;
        if (isPlaying) startSlideshow(); // Restart with new interval
    });

    // Keybind Remapping Logic
    const keybindInputs = document.querySelectorAll('.keybind-input');
    keybindInputs.forEach(input => {
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            const action = input.id.replace('key-', '');
            const newKey = e.key;

            // Allow Escape to cancel rebinding without saving
            if (newKey === 'Escape') {
                input.blur();
                return;
            }

            keybinds[action] = newKey === ' ' ? ' ' : newKey;
            input.value = newKey;
            saveKeybinds();
            input.blur(); // Remove focus after mapping
        });
    });

    // Keyboard bindings (Hotkeys)
    document.addEventListener('keydown', (e) => {
        // Ignore if focus is in an input field (unless we are remapping)
        if (e.target.classList.contains('keybind-input')) return;
        if (e.target.tagName.toLowerCase() === 'input' || e.target.tagName.toLowerCase() === 'select') return;

        const key = e.key;

        if (key === keybinds.next) {
            nextSlide();
        } else if (key === keybinds.prev) {
            prevSlide();
        } else if (key === keybinds.play) {
            e.preventDefault(); // Prevent scrolling if space
            togglePlay();
        } else if (key === keybinds.speedup) {
            e.preventDefault();
            timerInput.value = parseInt(timerInput.value, 10) + 1;
            timerInput.dispatchEvent(new Event('change'));
        } else if (key === keybinds.speeddown) {
            e.preventDefault();
            if (parseInt(timerInput.value, 10) > 1) {
                timerInput.value = parseInt(timerInput.value, 10) - 1;
                timerInput.dispatchEvent(new Event('change'));
            }
        } else if (key === keybinds.sidebar || key === keybinds.sidebar.toLowerCase() || key === keybinds.sidebar.toUpperCase()) {
            sidebar.classList.toggle('open');
        }
    });
}
