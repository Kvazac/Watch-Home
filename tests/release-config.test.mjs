import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  fs.readFileSync("extension/manifest.json", "utf8")
);
const packageJson = JSON.parse(
  fs.readFileSync("package.json", "utf8")
);
const config = fs.readFileSync("extension/config.js", "utf8");

test("package and manifest versions stay aligned", () => {
  assert.equal(packageJson.version, manifest.version);
});

test("production backend is configured exactly", () => {
  assert.match(
    config,
    /https:\/\/watch-home\.ugnius-socials\.workers\.dev/
  );
  assert.doesNotMatch(config, /example\.workers\.dev/);
});

test("manifest uses the permanent self-hosted update URL", () => {
  assert.equal(
    manifest.browser_specific_settings.gecko.update_url,
    "https://kvazac.github.io/Watch-Home/updates.json"
  );
});

test("manifest keeps narrow permissions", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.incognito, "not_allowed");
  assert.ok(
    !manifest.host_permissions.includes("<all_urls>")
  );
});
