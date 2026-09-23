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

// Auto-Load State
let autoLoadActive = false;
let pagesLoaded = 0;
let isExtracting = false;
let originalDomain = "";

// DOM Elements - New ones
const enableTabsBtn = document.getElementById('enable-tabs-btn');
const tabSelectionUi = document.getElementById('tab-selection-ui');
const refreshTabsBtn = document.getElementById('refresh-tabs-btn');
const tabList = document.getElementById('tab-list');
const sameDomainOnlyCb = document.getElementById('same-domain-only');
const autoLoadNextCb = document.getElementById('auto-load-next');
const autoLoadOptions = document.getElementById('auto-load-options');
const maxPagesInput = document.getElementById('max-pages-input');
const targetImagesInput = document.getElementById('target-images-input');
const autoLoadStatus = document.getElementById('auto-load-status');

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
            if (rawMediaData.pageUrl) {
                try {
                    originalDomain = new URL(rawMediaData.pageUrl).hostname;
                } catch(e) {}
            }
            buildPlaylist();
            showMedia(0);
            startSlideshow();
        } else {
            console.error("No media data found.");
        }
    });

    setupEventListeners();
    setupMultiTabListeners();
});

function updateKeybindUI() {
    document.getElementById('key-next').value = keybinds.next;
    document.getElementById('key-prev').value = keybinds.prev;
    document.getElementById('key-play').value = keybinds.play;
    document.getElementById('key-speedup').value = keybinds.speedup;
    document.getElementById('key-speeddown').value = keybinds.speeddown;
    document.getElementById('key-sidebar').value = keybinds.sidebar;
}

function setupMultiTabListeners() {
    enableTabsBtn.addEventListener('click', () => {
        enableTabsBtn.style.display = 'none';
        tabSelectionUi.style.display = 'block';
        refreshTabs();
    });

    refreshTabsBtn.addEventListener('click', refreshTabs);
    sameDomainOnlyCb.addEventListener('change', refreshTabs);

    autoLoadNextCb.addEventListener('change', (e) => {
        autoLoadActive = e.target.checked;
        autoLoadOptions.style.display = autoLoadActive ? 'block' : 'none';

        if (autoLoadActive && !isExtracting) {
            checkAndLoadNextPage();
        }
    });

    maxPagesInput.addEventListener('change', () => {
        if (autoLoadActive && !isExtracting) checkAndLoadNextPage();
    });

    targetImagesInput.addEventListener('change', () => {
        if (autoLoadActive && !isExtracting) checkAndLoadNextPage();
    });
}

function refreshTabs() {
    chrome.runtime.sendMessage({ action: "getTabs" }, (response) => {
        if (response && response.tabs) {
            tabList.innerHTML = '';

            const filteredTabs = response.tabs.filter(tab => {
                // Don't show the slideshow tab itself
                if (tab.url === window.location.href) return false;

                if (sameDomainOnlyCb.checked && originalDomain) {
                    try {
                        const tabDomain = new URL(tab.url).hostname;
                        return tabDomain === originalDomain;
                    } catch(e) {
                        return false; // skip invalid urls
                    }
                }
                return true;
            });

            if (filteredTabs.length === 0) {
                tabList.innerHTML = '<li class="info-text">No tabs found matching criteria.</li>';
                return;
            }

            filteredTabs.forEach(tab => {
                const li = document.createElement('li');
                li.className = 'tab-list-item';

                const titleSpan = document.createElement('span');
                titleSpan.textContent = tab.title.length > 30 ? tab.title.substring(0, 30) + '...' : tab.title;
                titleSpan.title = tab.title;

                const addBtn = document.createElement('button');
                addBtn.textContent = 'Add Media';
                addBtn.onclick = () => {
                    addBtn.disabled = true;
                    addBtn.textContent = 'Adding...';
                    extractFromTabId(tab.id, addBtn);
                };

                li.appendChild(titleSpan);
                li.appendChild(addBtn);
                tabList.appendChild(li);
            });
        }
    });
}

function mergeMediaData(newData) {
    if (!newData) return;

    let addedCount = 0;

    ['mediaList', 'galleries', 'strictProminent'].forEach(key => {
        if (newData[key]) {
            newData[key].forEach(newItem => {
                // Check for duplicates
                const exists = rawMediaData[key].some(existingItem => existingItem.url === newItem.url);
                if (!exists) {
                    rawMediaData[key].push(newItem);
                    addedCount++;
                }
            });
        }
    });

    if ('nextPageUrl' in newData) {
        rawMediaData.nextPageUrl = newData.nextPageUrl;
    }

    if (addedCount > 0) {
        // Rebuild playlist without interrupting current index completely
        const oldUrl = currentPlaylist.length > 0 ? currentPlaylist[currentIndex].url : null;

        buildPlaylist();

        // Try to maintain current image if possible
        if (oldUrl) {
            const newIndex = currentPlaylist.findIndex(m => m.url === oldUrl);
            if (newIndex !== -1) {
                currentIndex = newIndex;
            }
        }
    }

    return addedCount;
}

function extractFromTabId(tabId, btnElement) {
    chrome.runtime.sendMessage({ action: "extractFromTab", tabId: tabId }, (response) => {
        if (response && response.data) {
            mergeMediaData(response.data);
            if (btnElement) {
                btnElement.textContent = 'Done';
                btnElement.style.background = '#666';
            }
        } else {
            if (btnElement) {
                btnElement.textContent = 'Error';
                btnElement.style.background = '#f44336';
            }
        }
    });
}

function checkAndLoadNextPage() {
    if (!autoLoadActive || isExtracting || !rawMediaData) return;

    const maxPages = parseInt(maxPagesInput.value, 10);
    const targetImages = parseInt(targetImagesInput.value, 10);

    if (pagesLoaded >= maxPages) {
        autoLoadStatus.textContent = `Reached max pages (${maxPages}).`;
        return;
    }

    if (currentPlaylist.length >= targetImages) {
        autoLoadStatus.textContent = `Reached target images (${currentPlaylist.length}/${targetImages}).`;
        return;
    }

    if (!rawMediaData.nextPageUrl) {
        autoLoadStatus.textContent = "No 'Next Page' link detected.";
        return;
    }

    // Load next page
    isExtracting = true;
    autoLoadStatus.textContent = `Loading page ${pagesLoaded + 1} of ${maxPages}...`;

    chrome.runtime.sendMessage({ action: "extractFromUrl", url: rawMediaData.nextPageUrl }, (response) => {
        isExtracting = false;

        if (response && response.data) {
            pagesLoaded++;
            mergeMediaData(response.data);
            autoLoadStatus.textContent = `Successfully added media. Current total: ${currentPlaylist.length}`;

            // Check again recursively
            setTimeout(() => {
                checkAndLoadNextPage();
            }, 1000); // small delay to not spam
        } else {
            autoLoadStatus.textContent = `Error loading next page: ${response ? response.error : 'Unknown'}`;
        }
    });
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
