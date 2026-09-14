# Administrator Tasks for Steps 1–10

The implementation for steps 1–10 is in the repository. The remaining work is
real-world testing because automated tests cannot reproduce Netflix buffering,
Firefox autoplay policy, home-network jitter, or two physical devices.

All terminal examples below are for **Windows Command Prompt (`cmd.exe`)**.
Do not use Bash line continuations such as `\`.

## Before testing

Copy the updated files into your local repository, then run:

```cmd
cd C:\Users\Kvazac\Documents\GitHub\Watch-Home
npm install
scripts\verify-local.cmd
scripts\health-check.cmd
```

Expected:

- all Node tests pass;
- Firefox lint has 0 errors;
- the known Firefox Android compatibility warning may remain;
- conformity check passes;
- runtime audit passes;
- Wrangler dry-run passes;
- Worker health returns JSON.

## Deploy the compatible backend first

The Worker changes remain compatible with the already installed v1.0.0
extension.

Commit and push the updated source:

```cmd
git add -A
git status
git commit -m "Implement synchronization hardening and v1 test gates"
git push origin main
```

Wait for:

- GitHub **CI** to pass;
- Cloudflare's Git-connected Worker build/deploy to pass.

Then:

```cmd
scripts\health-check.cmd
```

The health response should include release `1.1.0`.

## Test the extension before Mozilla signing

For development testing, run:

```cmd
npx web-ext run --source-dir extension
```

Use this for quick iteration. For final verification, use a Mozilla-signed XPI.

Follow `docs\TESTING.md` in order. The popup's Diagnostics section is designed
for this process.

## Step 1 — guest join

Your task:

- use two Firefox profiles or machines;
- create a room on the host;
- wait 30 seconds before joining from the guest;
- confirm late join catches up and participant count becomes 2.

## Step 2 — playback controls

Your task:

- repeatedly test host play/pause/seek/rate changes;
- intentionally pause/seek the guest;
- confirm the guest is pulled back without an event loop.

## Step 3 — seamlessness

Your task:

- open Diagnostics on the guest;
- observe stable drift;
- create small and large manual drift;
- copy Diagnostics if normal stable drift is repeatedly over ~300 ms.

No terminal command is required for this step.

## Step 4 — buffering

Your task:

- create a short guest-side network interruption;
- create a host-side buffering event;
- verify the asymmetric behavior in `docs\TESTING.md`.

Network shaping is optional; physically toggling Wi-Fi briefly is enough for
the first test.

## Step 5 — reconnect/restart

Your task:

- Wi-Fi off/on;
- reload Netflix tabs;
- restart Firefox;
- sleep/wake one machine.

Confirm the same room reconnects without re-entering the code.

## Step 6 — Netflix navigation

Your task:

- next-episode transition;
- manually change host episode;
- put the guest on a wrong episode;
- use **Open correct Netflix video**.

## Step 7 — host lifecycle

Your task:

- disconnect/reconnect host;
- verify guests freeze while host is offline;
- leave on every client and create a fresh room.

## Step 8 — real second-device session

Your task:

- test on two physical devices if possible;
- run one full episode or at least 45 minutes;
- copy Diagnostics on any visible desync.

This is the most important acceptance test.

## Step 9 — security/compliance review

Run:

```cmd
scripts\verify-local.cmd
npm audit
git diff
git status
```

Do not use:

```cmd
npm audit fix --force
```

unless a specific dependency change has been reviewed.

Also read:

- `PRIVACY.md`
- `MOZILLA_COMPLIANCE.md`

Confirm they still describe the actual behavior you observed.

## Step 10 — release 1.1.0

When steps 1–9 pass:

```cmd
scripts\release-preflight.cmd 1.1.0
git status
git log -1 --oneline
```

If clean/passing, push any final fixes:

```cmd
git add -A
git commit -m "Prepare Watch Home 1.1.0"
git push origin main
```

Wait for CI and Cloudflare deploy.

Then GitHub:

1. Actions.
2. **Sign and release Firefox extension**.
3. **Run workflow**.
4. Enter `1.1.0`.
5. Wait for signing and Pages deployment.
6. Download `watch-home-1.1.0.xpi` from Releases.
7. Test installation in normal Firefox.
8. On a Firefox profile still running 1.0.0, use Add-ons -> Check for Updates.
9. Confirm it updates to 1.1.0 automatically.

Do not distribute 1.1.0 until the signed-XPI and auto-update tests both pass.

## Future release version bump

Use one CMD-safe command:

```cmd
npm run version:set -- 1.1.1
```

This updates both `package.json` and `extension/manifest.json`.
