# Watch Home

Private Firefox extension for synchronizing Netflix playback between a small
trusted group.

## Project layout

- `worker/`: Cloudflare Worker + Durable Object room server.
- `extension-src/`: readable Firefox extension source.
- `scripts/`: deterministic extension build and update-manifest generation.
- `pages/`: GitHub Pages landing page.
- `.github/workflows/`: validation and signed-release automation.
- `MOZILLA_COMPLIANCE.md`: release compliance checklist.
- `PRIVACY.md`: data handling documentation.

## Prerequisites

- Node.js 22 or another currently supported Node.js release.
- A Cloudflare account with Workers enabled.
- A Mozilla Add-ons developer account.
- GitHub repository `Kvazac/Watch-Home`.

## First Cloudflare deployment

1. Push this repository to the `main` branch.
2. In Cloudflare, reconnect the GitHub integration if cloning fails.
3. Keep the root directory `/`.
4. Build command: none.
5. Deploy command: `npx wrangler deploy`.
6. Confirm the Worker name is exactly `watch-home`.
7. After deployment, open `https://<worker-host>/health`.
8. Put the resulting HTTPS origin into `project.config.json` as
   `backendOrigin`.
9. Commit and push that change.

## Local extension validation

```sh
npm install
npm run lint:extension
npm run run:extension
```

`npm run build:extension` copies the readable source into `build/extension`
and substitutes only project configuration values. It does not transpile,
bundle, minify, or download code.

## Release process

Before the first release:

1. Enable GitHub Pages with **GitHub Actions** as the source.
2. Create AMO API credentials.
3. Add repository Actions secrets:
   - `AMO_JWT_ISSUER`
   - `AMO_JWT_SECRET`
4. Verify `project.config.json` contains the production backend URL.
5. Verify `package.json` contains the release version.

Create and push a matching tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The release workflow:

1. Builds and lints the extension.
2. Submits it to Mozilla as an **unlisted** add-on.
3. Receives the Mozilla-signed XPI.
4. Publishes that XPI in GitHub Releases.
5. Generates `updates.json` with a SHA-256 hash.
6. Deploys `updates.json` to GitHub Pages.

Installed copies use:

`https://kvazac.github.io/Watch-Home/updates.json`

for Firefox's automatic update checks.

## User installation

Users download the signed `.xpi` from the latest GitHub Release, then use:

Firefox → Add-ons and themes → gear menu → Install Add-on From File.

After the first installation, Firefox uses the update manifest for subsequent
updates.
