# Mozilla Add-on Conformity Checklist

This file documents the intended conformity boundary for Watch Home. It is not
a substitute for Mozilla validation or review. A release is considered
production-ready only after `web-ext lint` passes and Mozilla returns a signed
XPI.

## Signing

- Manifest V3 has a fixed Firefox add-on ID: `watch-home@Kvazac`.
- Production builds are submitted to Mozilla as `unlisted`.
- Only Mozilla-signed XPI files are distributed.
- Self-hosting does not bypass Firefox signing requirements.

Reference:
https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox

## Distribution

- Distribution is self-hosted through GitHub Releases.
- The extension remains unlisted on AMO.
- The extension uses an HTTPS self-hosted update manifest.
- The update URL is fixed at:
  `https://kvazac.github.io/Watch-Home/updates.json`

## Permissions

Required WebExtension permissions are intentionally narrow:

- `storage` — client/session reconnection state;
- Netflix host access — the page the extension synchronizes;
- the configured Cloudflare Worker host — the synchronization service.

The extension does not request:

- cookies;
- history;
- bookmarks;
- downloads;
- all-sites access;
- native messaging.

## Data collection declaration

The manifest declares required:

- `browsingActivity` — the Netflix watch identifier identifies the active
  Netflix watch page;
- `websiteActivity` — play/pause/seek/rate/timing interactions are transmitted
  for synchronization.

The extension does not declare `none`, because synchronization requires these
data to leave the local browser.

## Executable code

- All executable extension JavaScript is packaged inside the XPI.
- No remote JavaScript is downloaded or executed.
- No `eval` or equivalent dynamic-code loading is used.
- Source is plain JavaScript with no minification or obfuscation.

## Transport

- Update traffic uses HTTPS.
- Synchronization uses secure WebSocket (`wss://`) only.

## Private browsing

The manifest uses `incognito: "not_allowed"`.

## Release gate

Every release must pass:

1. `npm test`
2. `npm run lint:addon`
3. production-backend placeholder verification
4. Mozilla unlisted signing
5. signed XPI upload to GitHub Releases
6. generation/deployment of an update manifest containing the XPI SHA-256
7. installation/update verification in normal Firefox

Relevant Mozilla references:

- https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/manage/updating-your-extension/
