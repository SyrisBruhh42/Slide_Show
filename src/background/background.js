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
