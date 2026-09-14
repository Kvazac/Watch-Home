# Watch Home Privacy Notice

Last updated: 2026-09-15

Watch Home exists only to coordinate playback within an active private watch
party.

## Data transmitted for required functionality

During an active party the extension can transmit:

- a randomly generated room identifier;
- the Netflix watch identifier for the active `/watch/...` page;
- playback position;
- play, pause, stall, and playback-rate state;
- synchronization timestamps and sequence numbers;
- a randomly generated local client identifier used to reconnect the host.

These values are required to synchronize playback.

## Local diagnostics

The extension locally calculates synchronization diagnostics such as:

- estimated playback drift;
- server round-trip time and clock offset;
- learned play/seek recovery latency;
- correction mode/counts.

These diagnostic values are displayed locally in the extension popup and are
not sent to the Watch Home server. They leave the browser only if the user
explicitly chooses **Copy diagnostics** and then shares the copied text.

## Data not intentionally collected by the application

Watch Home does not intentionally collect or transmit:

- Netflix usernames or passwords;
- Netflix authentication cookies;
- email addresses or real names;
- audio or video content;
- subtitles;
- advertising identifiers;
- analytics identifiers;
- unrelated browsing history;
- search terms.

## Storage

Firefox local extension storage keeps the local client identifier and current
room session so that the extension can reconnect after a reload/restart.

The Cloudflare Durable Object stores only temporary room-coordination state.
When the last participant disconnects, the application deletes the room's
stored state.

Cloudflare and GitHub may process network metadata such as IP addresses as
infrastructure providers under their own policies. Watch Home does not use
that metadata for application analytics, advertising, profiling, or room
functionality.

## Distribution and updates

Firefox checks the Watch Home GitHub Pages update manifest. Release files are
hosted as Mozilla-signed XPI assets in GitHub Releases.

## Contact

Use the GitHub repository issue tracker for privacy or security questions.
