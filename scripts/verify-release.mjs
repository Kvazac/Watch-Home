import fs from "node:fs/promises";

const expectedVersion = process.argv[2];

if (!expectedVersion) {
  console.error("Usage: node scripts/verify-release.mjs <version>");
  process.exit(1);
}

const manifest = JSON.parse(
  await fs.readFile("extension/manifest.json", "utf8")
);
const packageJson = JSON.parse(
  await fs.readFile("package.json", "utf8")
);
const config = await fs.readFile("extension/config.js", "utf8");

if (manifest.version !== expectedVersion) {
  console.error(
    `Manifest version ${manifest.version} does not match requested release ${expectedVersion}.`
  );
  process.exit(1);
}

if (packageJson.version !== expectedVersion) {
  console.error(
    `package.json version ${packageJson.version} does not match requested release ${expectedVersion}.`
  );
  process.exit(1);
}

if (config.includes("example.workers.dev")) {
  console.error(
    "Production backend is still the placeholder example.workers.dev."
  );
  process.exit(1);
}

if (
  !config.includes(
    "https://watch-home.ugnius-socials.workers.dev"
  )
) {
  console.error("Unexpected production Worker URL.");
  process.exit(1);
}

const updateUrl =
  manifest.browser_specific_settings?.gecko?.update_url;

if (
  updateUrl !==
  "https://kvazac.github.io/Watch-Home/updates.json"
) {
  console.error(`Unexpected update_url: ${updateUrl}`);
  process.exit(1);
}

if (
  manifest.browser_specific_settings?.gecko?.id !==
  "watch-home@Kvazac"
) {
  console.error("Unexpected Firefox extension ID.");
  process.exit(1);
}

console.log(`Release verification passed for ${expectedVersion}.`);
