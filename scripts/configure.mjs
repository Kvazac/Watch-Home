import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const backend = readArgument("--backend");

if (!backend) {
  fail(
    "Usage: npm run configure -- --backend https://watch-home.YOUR-SUBDOMAIN.workers.dev"
  );
}

let backendUrl;
try {
  backendUrl = new URL(backend);
} catch {
  fail("The backend must be a valid HTTPS URL.");
}

if (
  backendUrl.protocol !== "https:" ||
  backendUrl.pathname !== "/" ||
  backendUrl.search ||
  backendUrl.hash
) {
  fail("Use only the HTTPS backend origin, with no path/query/hash.");
}

const httpOrigin = backendUrl.origin;
const wsOrigin = `wss://${backendUrl.host}`;

const configPath = path.join(root, "extension", "config.js");
const configText = `"use strict";

globalThis.WatchHomeConfig = Object.freeze({
  backendHttpOrigin: ${JSON.stringify(httpOrigin)},
  backendWsOrigin: ${JSON.stringify(wsOrigin)},
  heartbeatIntervalMs: 2500,
  clockSyncIntervalMs: 10000,
  hostStallDebounceMs: 200,
  reconnectBaseMs: 500,
  reconnectMaxMs: 10000
});
`;

await fs.writeFile(configPath, configText, "utf8");

const manifestPath = path.join(root, "extension", "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

manifest.host_permissions = manifest.host_permissions.filter(
  (value) =>
    !value.includes("example.workers.dev") &&
    !/https:\/\/[^/]+\.workers\.dev\/\*/.test(value)
);

manifest.host_permissions.push(`${httpOrigin}/*`);

await fs.writeFile(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(`Configured extension backend: ${httpOrigin}`);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
