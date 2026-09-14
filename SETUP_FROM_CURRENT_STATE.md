# Setup from the current state

The Cloudflare screenshot shows:

- initialization succeeds;
- cloning starts;
- cloning fails with `Failed: error occurred while fetching repository`;
- install and deploy never start.

Therefore the failure happens before Wrangler or any repository file is read.

## Fix the clone first

1. Make sure `Kvazac/Watch-Home` has at least one commit on `main`.
2. If the repository is private, open GitHub:
   Settings → Applications → Installed GitHub Apps →
   Cloudflare Workers and Pages → Configure.
3. Grant the app access to `Watch-Home` (or all repositories).
4. In Cloudflare:
   Workers & Pages → watch-home → Settings → Builds →
   Git Repository → Manage.
5. Reconnect/reinstall the GitHub integration if necessary.
6. Retry only after this scaffold has been pushed to `main`.

Cloudflare's configured root `/` and deploy command `npx wrangler deploy`
match this scaffold.

After the first successful deployment, replace the placeholder
`backendOrigin` in `project.config.json` with the exact HTTPS workers.dev
origin, commit it, and push again.
