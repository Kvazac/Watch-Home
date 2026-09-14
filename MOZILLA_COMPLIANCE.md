# Mozilla Add-on Conformity Checklist

This file documents the intended conformity boundary for Watch Home. It is not
a substitute for Mozilla validation or review. A release is production-ready
only after local/CI checks pass and Mozilla returns a signed XPI.

## Signing

- Manifest V3 has fixed Firefox add-on ID `watch-home@Kvazac`.
- Production builds are submitted to Mozilla as `unlisted`.
- Only Mozilla-signed XPI files are distributed.
- Self-hosting does not bypass Firefox signing requirements.

Reference:
https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox

## Distribution and updates

- GitHub Releases hosts signed XPI files.
- GitHub Pages hosts the HTTPS Firefox update manifest.
- Permanent update URL:
  `https://kvazac.github.io/Watch-Home/updates.json`
- Every update XPI is Mozilla-signed before it is advertised.

## Permissions

Required WebExtension permissions remain narrow:

- `storage` — client/session reconnection state;
- `https://www.netflix.com/*` — playback page synchronization;
- exact production Worker origin — synchronization WebSocket service.

The extension does not request cookies, history, bookmarks, downloads,
`<all_urls>`, or native messaging.

## Data collection declaration

The manifest declares required:

- `browsingActivity` — the Netflix watch identifier identifies the active
  Netflix watch page;
- `websiteActivity` — play/pause/seek/rate/timing interactions are transmitted
  for synchronization.

Local diagnostics (drift/RTT/latency/correction counters) are not transmitted
to Watch Home infrastructure.

## Executable code

- All executable extension JavaScript ships inside the XPI.
- No remote JavaScript is downloaded or executed.
- `eval` and `new Function` are prohibited by automated checks.
- Source remains readable plain JavaScript.

## Transport

- Update traffic uses HTTPS.
- Synchronization uses WSS only.

## Private browsing

The manifest uses `incognito: "not_allowed"`.

## Automated release gate

Every release runs:

1. Node unit tests, including synchronization math;
2. `web-ext lint --self-hosted`;
3. `scripts/compliance-check.mjs`;
4. `npm audit --omit=dev`;
5. Wrangler dry-run build;
6. version/backend/update-URL release verification;
7. Mozilla unlisted signing;
8. GitHub Release upload;
9. SHA-256 update-manifest generation;
10. GitHub Pages deployment.

The Firefox Android min-version lint warning is not treated as desktop support.
Watch Home v1 targets Firefox desktop.

Relevant Mozilla references:

- https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/manage/updating-your-extension/
