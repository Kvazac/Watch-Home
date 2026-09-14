# Mozilla compliance checklist

This file documents the intended conformance of Watch Home. Final conformance
must be checked again for every release and is not complete until Mozilla has
accepted and signed that release.

Official references:

- https://support.mozilla.org/en-US/kb/add-on-signing-in-firefox
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
- https://extensionworkshop.com/documentation/manage/updating-your-extension/
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings

## Release requirements

- [ ] Production XPI is signed by Mozilla.
- [ ] Distribution channel is AMO `unlisted` / self-distributed.
- [ ] `browser_specific_settings.gecko.id` remains `watch-home@Kvazac`.
- [ ] `strict_min_version` remains compatible with all used APIs.
- [ ] `update_url` remains HTTPS and stable.
- [ ] `web-ext lint` passes.
- [ ] No remote JavaScript, WebAssembly, or other executable code is loaded.
- [ ] No `eval`, `new Function`, or equivalent dynamic execution exists.
- [ ] Network transport uses HTTPS/WSS.
- [ ] Host permissions are limited to Netflix and the exact production backend.
- [ ] Requested API permissions are necessary for implemented features.
- [ ] `data_collection_permissions` matches actual transmitted data.
- [ ] `PRIVACY.md` matches actual transmitted and retained data.
- [ ] The extension does not transmit Netflix cookies or credentials.
- [ ] The extension does not run in private browsing (`incognito: not_allowed`).
- [ ] Source is readable; release code is not obfuscated or minified.
- [ ] Any third-party dependencies included in the XPI are reviewed. The
      current extension runtime contains no third-party libraries.
- [ ] Automatic-update manifest points only to a Mozilla-signed XPI.
- [ ] The update manifest SHA-256 matches the published signed XPI.
- [ ] A clean stable Firefox profile can install the signed XPI.
- [ ] An installed prior version successfully auto-updates to the new version.

## Current data declarations

Required:

- `browsingActivity`
- `websiteActivity`

The extension does not declare `none` because active Netflix media identity and
playback interactions are transmitted to the coordination service.

## Permission rationale

- `storage`: remembers the current private room so a Netflix page refresh or
  temporary network interruption can reconnect automatically.
- `clipboardWrite`: implements the explicit user-facing "Copy invite" button.
- `https://www.netflix.com/*`: reads and controls the active Netflix video
  element on watch pages.
- exact Cloudflare backend origin: creates rooms and opens the synchronization
  WebSocket.

Any new permission requires an entry here before release.
