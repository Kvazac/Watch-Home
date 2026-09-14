# Watch Home

Watch Home is a small, private Firefox extension that synchronizes Netflix
playback between trusted participants. Every participant streams Netflix from
their own Netflix account. Watch Home only coordinates playback state.

## User installation

1. Open the latest GitHub Release.
2. Download `watch-home-<version>.xpi`.
3. In Firefox open **Add-ons and themes**.
4. Open the gear menu and choose **Install Add-on From File**.
5. Select the downloaded XPI.

After the first installation, Firefox checks the self-hosted update manifest
and can update later Mozilla-signed releases automatically.

## Use

### Host

1. Open a Netflix `/watch/...` page.
2. Click the Watch Home toolbar button.
3. Click **Create party**.
4. Send the generated invite to the guest.

### Guest

1. Open the Netflix link from the invite.
2. Click Watch Home.
3. Paste the room code.
4. Click **Join party**.

The host is the playback authority in v1.

## Repository layout

- `extension/` — Firefox Manifest V3 extension.
- `worker/` — Cloudflare Worker and Durable Object.
- `scripts/` — configuration and release helpers.
- `site/` — static files deployed to GitHub Pages.
- `.github/workflows/` — CI and signed release automation.
- `docs/` — administrator and testing documentation.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm test
npm run lint:addon
npm run dev:worker
```

Before signing a production build, configure the final Workers URL:

```bash
npm run configure -- --backend https://watch-home.YOUR-SUBDOMAIN.workers.dev
```

Then commit the resulting changes.

## Privacy

See `PRIVACY.md`.

## Mozilla conformity

See `MOZILLA_COMPLIANCE.md`.

## License

MIT.
