# Administrator Setup

This is the from-scratch setup sequence for `Kvazac/Watch-Home`.

## 1. Make the GitHub repository usable by Cloudflare

The current Cloudflare failure occurs during repository cloning, before
Wrangler or application code executes.

For the simplest zero-cost setup, make the repository public. GitHub Pages on
GitHub Free requires a public repository.

If you keep it private, make sure the **Cloudflare Workers and Pages** GitHub
App has explicit access to `Kvazac/Watch-Home`, then reconnect it under the
Worker's **Settings > Builds > Git Repository**.

After access is fixed, retry the build.

## 2. Upload this repository scaffold

Upload everything at the repository root.

If `.github` is hidden by your operating system or GitHub upload dialog, create
the workflow files directly in GitHub:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

Using git from a local clone is more reliable because hidden folders are
included normally.

## 3. Cloudflare Worker build settings

Use:

- Root directory: `/`
- Build command: none
- Deploy command: `npx wrangler deploy`

The Worker script name must match `wrangler.jsonc`:

`watch-home`

If Cloudflare reports a Worker-name mismatch, check the actual Worker script
name in Cloudflare and either rename the Worker to `watch-home` or update the
`name` field in `wrangler.jsonc`.

## 4. Deploy the Worker

After the repository clone succeeds, Cloudflare installs the npm dependencies
and runs Wrangler.

Confirm:

`https://<your-worker-host>/health`

returns JSON with `"ok": true`.

Copy the exact HTTPS `workers.dev` origin.

## 5. Configure the extension with the Worker origin

Run locally:

```bash
npm install
npm run configure -- --backend https://watch-home.YOUR-SUBDOMAIN.workers.dev
npm test
npm run lint:addon
```

Commit the changed `extension/config.js` and `extension/manifest.json`.

If you do not use a local git clone, manually replace the placeholder Worker
origin in those same two files.

## 6. Enable GitHub Pages

Open:

Repository > Settings > Pages

Set **Source** to **GitHub Actions**.

Do not choose a branch source. The release workflow deploys the update
manifest directly after a signed release is created.

The permanent update URL embedded in the extension is:

`https://kvazac.github.io/Watch-Home/updates.json`

Do not rename/delete the repository after distributing v1 unless you also
maintain a redirect/recovery strategy.

## 7. Create a Mozilla Add-ons developer account

Sign in to the AMO Developer Hub and create API credentials.

Record:

- JWT issuer
- JWT secret

Production Firefox requires self-distributed extensions to be Mozilla-signed.

## 8. Add GitHub Actions secrets

Repository > Settings > Secrets and variables > Actions

Create:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

Never commit these values.

## 9. Test locally before signing

Run:

```bash
npm install
npm test
npm run lint:addon
npm run build:addon
```

For temporary development testing:

```bash
npx web-ext run --source-dir extension
```

Use two Firefox profiles/windows to test host and guest behavior.

## 10. Run the first signed release

The manifest starts at version `1.0.0`.

Open:

Repository > Actions > Sign and release Firefox extension > Run workflow

Enter:

`1.0.0`

The workflow:

1. installs Node 22 dependencies;
2. runs tests;
3. runs `web-ext lint`;
4. verifies the real Worker URL is configured;
5. submits the extension to Mozilla for **unlisted** signing;
6. renames the signed file to `watch-home-1.0.0.xpi`;
7. creates GitHub Release `v1.0.0`;
8. generates `updates.json` with the signed XPI SHA-256;
9. deploys the update manifest to GitHub Pages.

Mozilla can delay signing if manual review is selected. Re-run only after
checking the AMO version status.

## 11. Verify v1 installation

Download the XPI from the GitHub Release.

In normal Firefox:

Add-ons and themes > gear menu > Install Add-on From File

Install the XPI.

Unsigned builds must not be distributed.

## 12. Verify automatic updates before giving v1 to users

Create a small test update:

1. change `extension/manifest.json` from `1.0.0` to `1.0.1`;
2. commit;
3. run the release workflow with `1.0.1`;
4. confirm GitHub Pages `updates.json` now advertises `1.0.1`;
5. in the Firefox test profile, use **Check for Updates** in Add-ons Manager;
6. confirm Firefox updates from `1.0.0` to `1.0.1` without manual XPI install.

After this passes, distribute the latest signed XPI to the intended users.

## Normal future release routine

1. update code;
2. bump `extension/manifest.json`;
3. commit;
4. run CI;
5. manually run the release workflow with the matching version;
6. verify the GitHub Release and Pages update manifest.
