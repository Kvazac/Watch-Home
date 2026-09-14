# Administrator Setup

The initial GitHub, Cloudflare, Mozilla signing, and GitHub Pages setup is now
complete for the existing Watch Home installation.

For ongoing implementation/testing/release work, use:

- `docs/ADMIN_TASKS_1_TO_10.md`
- `docs/TESTING.md`

## Production constants

- GitHub: `Kvazac/Watch-Home`
- Firefox add-on ID: `watch-home@Kvazac`
- Worker: `https://watch-home.ugnius-socials.workers.dev`
- Update manifest: `https://kvazac.github.io/Watch-Home/updates.json`

Treat the Firefox add-on ID and update-manifest URL as permanent.

## Windows CMD quick verification

```cmd
cd C:\Users\Kvazac\Documents\GitHub\Watch-Home
npm install
scripts\verify-local.cmd
scripts\health-check.cmd
```

## Release

```cmd
scripts\release-preflight.cmd 1.1.0
```

Then push, wait for CI/Cloudflare, and run the GitHub
**Sign and release Firefox extension** workflow using the exact manifest
version.
