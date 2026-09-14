# Watch Home

Watch Home is a small private Firefox extension that synchronizes Netflix
playback between trusted participants. Every participant streams Netflix from
their own Netflix account; Watch Home only coordinates playback state.

## Current v1.1 scope

- host-authoritative play/pause/seek/playback-rate synchronization;
- predictive late-join and buffering recovery;
- clock-offset/RTT estimation;
- soft drift correction before hard seeking;
- host-stall propagation;
- automatic WebSocket/session recovery;
- Netflix episode/navigation tracking;
- wrong-title recovery;
- popup diagnostics for real-device testing;
- Mozilla-signed self-distribution through GitHub Releases;
- Firefox self-hosted automatic updates through GitHub Pages;
- automated CI, compliance checks, and release preflight.

## Installation

1. Open the latest GitHub Release.
2. Download `watch-home-<version>.xpi`.
3. Firefox -> Add-ons and themes.
4. Gear menu -> Install Add-on From File.
5. Select the downloaded Mozilla-signed XPI.

## Use

### Host

1. Open and start a Netflix `/watch/...` page.
2. Click Watch Home.
3. Click **Create party**.
4. Send the generated invite.

### Guest

1. Open the Netflix link from the invite.
2. Click Watch Home.
3. Enter the room code.
4. Click **Join party**.

The host is the playback authority in v1.

## Windows CMD development

```cmd
npm install
scripts\verify-local.cmd
scripts\health-check.cmd
npx web-ext run --source-dir extension
```

Do not use Unix `\` line continuations in Windows Command Prompt.

## Administrator testing/release

See:

- `docs/ADMIN_TASKS_1_TO_10.md`
- `docs/TESTING.md`
- `MOZILLA_COMPLIANCE.md`
- `PRIVACY.md`

## Privacy

See `PRIVACY.md`.

## License

MIT.
