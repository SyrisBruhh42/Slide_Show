/**
 * Media Isolator - Background Service Worker
 * Handles extension icon clicks and orchestrates data transfer between content scripts and the slideshow UI.
 */

chrome.action.onClicked.addListener(async (tab) => {
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
        console.warn("Cannot inject content script into privileged pages.");
        return;
    }

    try {
        // Ensure content script is injected (in case it wasn't statically loaded or it's a dynamic context)
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/content_scripts/content.js']
        }).catch(err => console.log("Script might already be injected or error:", err));

        // Request media extraction from the content script
        chrome.tabs.sendMessage(tab.id, { action: "extractMedia" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Error communicating with content script:", chrome.runtime.lastError);
                return;
            }

            if (response) {
                // Store the extracted data
                chrome.storage.local.set({ extractedMediaData: response }, () => {
                    // Open the slideshow in a new tab
                    chrome.tabs.create({ url: chrome.runtime.getURL("src/slideshow/slideshow.html") });
                });
            } else {
                console.warn("No response received from content script.");
            }
        });
    } catch (e) {
        console.error("Failed to execute script:", e);
    }
});

// Listen for messages from the slideshow UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getTabs") {
        chrome.tabs.query({}, (tabs) => {
            sendResponse({ tabs: tabs });
        });
        return true; // Keep channel open for async
    }

    if (request.action === "extractFromTab") {
        const tabId = request.tabId;

        // Try sending message first in case script is already injected
        chrome.tabs.sendMessage(tabId, { action: "extractMedia" }, (response) => {
            if (chrome.runtime.lastError) {
                // Not injected yet, inject it
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['src/content_scripts/content.js']
                }).then(() => {
                    chrome.tabs.sendMessage(tabId, { action: "extractMedia" }, (response) => {
                        if (chrome.runtime.lastError) {
                            sendResponse({ error: chrome.runtime.lastError.message });
                        } else {
                            sendResponse({ data: response });
                        }
                    });
                }).catch(err => {
                    sendResponse({ error: err.message });
                });
            } else {
                sendResponse({ data: response });
            }
        });
        return true; // Keep channel open
    }

    if (request.action === "extractFromUrl") {
        const url = request.url;

        // Create a new tab in the background (active: false)
        chrome.tabs.create({ url: url, active: false }, (newTab) => {
            // Wait for it to load completely
            const listener = (tabId, changeInfo) => {
                if (tabId === newTab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);

                    // Inject script and extract
                    chrome.scripting.executeScript({
                        target: { tabId: newTab.id },
                        files: ['src/content_scripts/content.js']
                    }).then(() => {
                        chrome.tabs.sendMessage(newTab.id, { action: "extractMedia" }, (response) => {
                            // Close the temporary tab immediately
                            chrome.tabs.remove(newTab.id);

                            if (chrome.runtime.lastError) {
                                sendResponse({ error: chrome.runtime.lastError.message });
                            } else {
                                sendResponse({ data: response });
                            }
                        });
                    }).catch(err => {
                        chrome.tabs.remove(newTab.id);
                        sendResponse({ error: err.message });
                    });
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        return true; // Keep channel open
    }
});
