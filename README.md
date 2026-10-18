# Slide_Show

<!-- lfs-alignment:begin v1 -->
## LFS alignment

Project role: Independent browser-extension prototype; source role needs confirmation.

This project keeps its own purpose and required features while sharing useful LFS practices: clear ownership, reusable capabilities, scoped access, evidence-based validation and recoverable work. Adopting these practices does not make this repository a deployed LFS service.

Use this README and local project documentation for scope, setup and status. Contributor guidance is in [AGENTS.md](AGENTS.md). A policy update is not proof of tested or delivered functionality.
<!-- lfs-alignment:end -->

## Curated collection viewer

Open a page containing images or video and click the extension action. The viewer keeps the loaded page's DOM sequence: enlarging an image and choosing Next does not replace the collection with related images. Each invocation has an independent collection and cursor. Collections live in browser-session storage, survive viewer reloads, and are removed when the viewer closes or the browser session ends. Keybindings remain in local extension storage.

The default view is **Original collection**, with obvious decorative media excluded. **All loaded media** retains those items, while **Largest image** keeps site-specific prominent-media selection for DeviantArt, Google, Reddit and Midjourney. Thumbnail-sized artwork remains eligible. The collector prefers the browser-selected picture source and available higher-resolution image candidates; an unavailable full-size image falls back to its original page preview. GIFs, videos, download controls, timer, configurable keys and fullscreen remain available. Playback starts when you press Play. Arrow Up shortens the delay; Arrow Down lengthens it.

While the source stays open, a bounded observer remembers images as its loaded page changes. Load more on the original page, then choose **Collect newly loaded images** in the viewer. Items are appended in first-observed order; removing or reordering their page elements does not erase the remembered collection. Known larger sources upgrade an item in place and preserve the selected item. Each collection belongs to its original document and URL; changing that source stops continuation and leaves the saved collection usable. Closing its viewer releases the source observer. At most four collections observe a single document.

For Google Images search, the collector uses the original `#rso` cards rather than the preview panel's related images. Stable card identifiers preserve position when a visible Google image link exposes its larger image URL. It does not guess inaccessible originals or call an undocumented search backend. Generic collection tracking excludes modal dialogs but cannot reliably infer every site's feed boundary or stable identity. Very short-lived images removed before observation may be missed. Original-page loading remains under user control.

This is an implementation candidate, not a completed cross-site release. Automatic scrolling, selected-tab aggregation, recovery after the browser session ends, all-site original-image resolution, DeviantArt feed qualification and native extension installation remain open. The retained multi-tab prototype branch has not been blindly merged. The complete goal remains a reliable, uncluttered curated slideshow across websites, including real DeviantArt and Google Images journeys.

## Development and verification

No build or dependency installation is required. Run the collection and continuation regressions with Node.js 24:

```sh
node tests/collection.test.cjs
node tests/continuation.test.cjs
```

The direct command is also useful in restricted environments where the test runner's subprocess wrapper can return a filename-level result without useful individual-test output. CI uses the ordinary Node test runner. The suite covers ordering, media candidates, picture art direction, exclusions, message origin, bounded validation, concurrent collections, tab-close/setup races, preview fallback, stale callbacks, icons and unchanged permissions.

Continuation cases cover virtualized removal/reordering, source upgrades without cursor loss, item/URL caps, source-document changes, Google card boundaries, observer teardown, unauthorized viewers, failed writes and late replies after viewer closure.

For a disposable browser preview of the real collector and viewer with simulated extension APIs:

```sh
python3 tests/preview-server.py
```

Open `http://127.0.0.1:8874/collector` and `http://127.0.0.1:8874/viewer?collection=11111111-1111-1111-1111-111111111111`. This does not install an extension or inspect browser tabs. The fixture's page sequence is A, B, C while image size order is B, C, A. Verify Capture preserves A, B, C; Next, Next, Previous shows B, C, B. Preview-server results do not establish native extension loading or real-site acceptance.

For continuation, Capture once, open the viewer and select B. In the collector choose **Remove A and load D**, then **Upgrade B image**. In the viewer collect newly loaded images: B stays selected at 2 / 4, its source upgrades, and Previous still reaches the removed A. The fixture uses local-only broadcast messages to connect the actual collector and viewer; it simulates extension transport/storage. Use `--port 8875` for an independent disposable instance. Reload the collector to reset its observation session.

The manifest uses the documented dual background declaration for Chrome and Firefox 121 or later; the worker conditionally imports the shared contract, while the document background loads both scripts in order. Native browser qualification remains required. See [Mozilla background compatibility](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) and [Chrome session storage](https://developer.chrome.com/docs/extensions/reference/api/storage). Safari packaging and qualification remain open.

The collector bounds work to 10,000 inspected elements and 2,000 accepted items. Oversized serialized collections are rejected. Only HTTP/HTTPS and bounded raster data images enter the media contract; file, credential-bearing and executable URLs are rejected. No broad host permission was added. Failed extraction sets an action badge and retry guidance. Closed-session cleanup is best effort if the browser storage API itself fails; browser-session storage still clears when the session ends.

Original icons can be regenerated with `python3 tools/generate-icons.py`. Current-source recovery is available through Git history. A source checkout, passing fixtures and hosted checks do not establish store publication, native extension permissions, long-session operation or complete feature acceptance.
