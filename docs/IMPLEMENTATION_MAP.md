# Implementation Map: Steps 1–10

## 1. Guest join / late join

Implemented in:

- `extension/background.js`
- `extension/content.js`
- `worker/src/party-room.js`

Changes include active-tab binding, canonical-state request on guest connect, presence
counting, late-join state application, and same-tab wrong-title recovery.

## 2. Core playback synchronization

Implemented in:

- `extension/netflix-player.js`
- `extension/sync-controller.js`
- `extension/content.js`

Host remains authoritative. Guest local play/pause/seek/rate changes are corrected
back to the canonical host timeline without sending guest state to the server.

## 3. Predictive seamlessness

Implemented in:

- `extension/shared/sync-math.js`
- `extension/sync-controller.js`
- `extension/background.js`

Includes clock-offset estimation, low-RTT sample selection, predicted host position,
soft playback-rate correction, hysteresis, sequence guards, learned play/seek
latency, and predictive hard seek.

## 4. Buffering behavior

Implemented in:

- `extension/content.js`
- `extension/sync-controller.js`

Host stalls are debounced and freeze guest playback. Guest buffering does not stop
the host; the guest predicts/catches up when media becomes playable again.

## 5. Connection recovery

Implemented in:

- `extension/background.js`
- `extension/content.js`

Includes persisted room session/client identity, exponential backoff with jitter,
rebind after reload/restart, reconnect state request, visibility/pageshow recovery,
and non-retryable server errors.

## 6. Netflix navigation

Implemented in:

- `extension/netflix-player.js`
- `extension/content.js`
- `extension/background.js`

Tracks SPA watch-ID changes, Netflix video-element replacement, wrong-title state,
and same-tab navigation to the canonical watch ID.

## 7. Host lifecycle

Implemented in:

- `worker/src/party-room.js`
- `worker/src/validation.js`
- `extension/background.js`
- `extension/sync-controller.js`

Host disconnect freezes the canonical timeline. The same host client can reconnect.
v1 intentionally does not migrate host authority. Room storage is removed when the
last socket leaves.

## 8. Second-device diagnostics

Implemented in:

- `extension/popup/popup.html`
- `extension/popup/popup.css`
- `extension/popup/popup.js`
- `extension/content.js`

Diagnostics show sync mode, drift, RTT, clock offset, sequence, learned latency,
and correction counters. Users can copy a diagnostic snapshot.

## 9. Security/compliance/release checks

Implemented in:

- `scripts/compliance-check.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `tests/*.test.mjs`
- `MOZILLA_COMPLIANCE.md`
- `PRIVACY.md`

CI checks tests, self-hosted Firefox lint, conformity invariants, production-runtime
audit, and a Wrangler dry-run.

## 10. Final release process

Implemented/documented in:

- `scripts/verify-local.cmd`
- `scripts/release-preflight.cmd`
- `scripts/health-check.cmd`
- `scripts/set-version.mjs`
- `docs/ADMIN_TASKS_1_TO_10.md`
- `docs/TESTING.md`

The implemented candidate version is `1.1.0`.
