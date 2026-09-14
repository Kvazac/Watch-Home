# v1 Test Matrix

## Backend

- `/health` returns HTTP 200.
- invalid room IDs are rejected.
- a guest cannot create a room without a host.
- a second unrelated host cannot replace the active host.
- host reconnect with the same client ID succeeds.
- room state is deleted after the last socket closes.

## Playback

Use two Firefox profiles with Netflix open to the same title.

- guest joins late and catches up;
- host play propagates;
- host pause propagates;
- host seek propagates;
- host playback-rate change propagates;
- guest local pause is corrected back to the host timeline;
- guest local seek is corrected;
- guest buffer does not stop host;
- guest recovery performs at most one hard correction;
- host buffer freezes guests after the debounce period;
- host resume restarts guests;
- 100–400 ms drift is corrected without a visible seek;
- >1.5 s drift uses a predictive seek;
- host refresh/reconnect restores the party;
- guest refresh/reconnect restores the party;
- wrong Netflix watch ID is reported;
- tab navigation to another Netflix watch ID is reported.

## Release

- `npm test` passes.
- `npm run lint:addon` passes.
- normal Firefox rejects the unsigned build.
- normal Firefox installs the Mozilla-signed XPI.
- GitHub Pages serves `updates.json`.
- update manifest references the signed GitHub Release asset.
- update SHA-256 matches the XPI.
- v1.0.0 automatically updates to a signed v1.0.1 test release.
