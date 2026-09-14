# Watch Home v1.1 Test Matrix

Use normal Firefox for final tests. For development, `web-ext run` is useful,
but the signed XPI must also be tested before release.

The popup now contains a **Diagnostics** section. On a guest, the most useful
fields are:

- Sync — current correction mode;
- Drift — predicted host position minus local position;
- RTT — measured server round-trip time;
- Play/seek latency — learned local recovery latency;
- Hard seeks / soft corrections — cumulative session correction counts.

Use **Copy diagnostics** when reporting a failure.

## 1. Guest join and late join

- Create a room on the host.
- Let the host play for at least 30 seconds.
- Open the invite URL on the guest.
- Join using the room code.
- Confirm the guest seeks close to the host's current predicted position.
- Confirm the participant count becomes 2.
- Leave/rejoin and confirm the state is restored.

Pass target: guest is normally within about 100–200 ms after settling.

## 2. Core playback synchronization

Run each action at least five times:

- host Play -> guest plays;
- host Pause -> guest pauses;
- host seek +30 s -> guest follows;
- host seek -30 s -> guest follows;
- host changes playback rate -> guest follows;
- guest manually pauses -> Watch Home returns it to host state;
- guest manually seeks -> Watch Home returns it to host state.

Pass target: no repeating play/pause/seek feedback loop.

## 3. Predictive seamlessness

With Diagnostics open on the guest:

- stable playback should usually show `in-sync`;
- manually move the guest about 0.2–0.5 s away from host;
- expect `soft-catch-up` or `soft-slow-down`, not an immediate visible seek;
- manually move the guest >1.5 s away;
- expect one `hard-seek`, followed by settling/in-sync;
- watch for oscillation between correction modes.

Record copied diagnostics if drift repeatedly exceeds 300 ms during stable
playback.

## 4. Buffering

### Guest buffering

- throttle/disrupt the guest connection briefly;
- host must continue playing;
- after the guest can play again, expect zero or one hard correction;
- guest should converge to the predicted host timeline.

### Host buffering

- disrupt the host connection enough for Netflix to buffer;
- stalls shorter than about 200 ms should generally be ignored;
- a real host stall should put the guest into `host-buffering`;
- guest should pause near the host's canonical position;
- host recovery should resume the room.

## 5. Connection recovery

Test:

- disable guest Wi-Fi for 5–15 seconds, then restore;
- disable host Wi-Fi for 5–15 seconds, then restore;
- reload the guest Netflix tab;
- reload the host Netflix tab;
- restart Firefox with the Netflix tab restored;
- sleep/wake a laptop if available.

Expected:

- room/session data survives locally;
- WebSocket reconnects automatically;
- host reconnect uses the same local client identity;
- guest requests the latest canonical state;
- stale server sequence numbers are ignored.

## 6. Netflix navigation

Test:

- allow Netflix to start the next episode;
- host manually selects another episode;
- guest intentionally opens the wrong episode;
- confirm the popup reports the mismatch;
- click **Open correct Netflix video** and confirm the active tab navigates;
- confirm synchronization resumes after Netflix replaces its video element.

## 7. Host lifecycle

- disconnect the host while the guest remains;
- guest should pause and show `Host disconnected`;
- reconnect the host and confirm the same party resumes;
- leave from all clients;
- create a new room and confirm no state leaks from the old room.

v1 intentionally has no host migration.

## 8. Second-device/full-session validation

Do not rely only on two profiles on one computer.

Recommended final test:

- two physical computers;
- independent Firefox/Netflix sessions;
- normal home internet/Wi-Fi;
- at least one full TV episode or 45+ minutes;
- perform several seeks and pauses during the session;
- capture diagnostics if anything visibly desynchronizes.

## 9. Release/security gate

From Windows Command Prompt:

```cmd
scripts\verify-local.cmd
npm audit
```

`verify-local.cmd` blocks release on:

- unit-test failure;
- Firefox self-hosted lint errors;
- conformity invariant failure;
- production/runtime dependency audit failure;
- Cloudflare dry-run build failure.

The full `npm audit` can still report development-tool dependency findings.
Review those separately; do not run `npm audit fix --force` blindly.

## 10. Final release gate

From Windows Command Prompt:

```cmd
scripts\health-check.cmd
scripts\release-preflight.cmd 1.1.0
git status
```

The working tree should contain only changes you intend to release.

Then push, wait for CI, and run the manual GitHub signing/release workflow with
the same version as `extension/manifest.json`.
