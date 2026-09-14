import fs from "node:fs/promises";
import path from "node:path";

const extensionRoot = path.resolve("extension");
const manifest = JSON.parse(
  await fs.readFile(path.join(extensionRoot, "manifest.json"), "utf8")
);
const failures = [];

const gecko = manifest.browser_specific_settings?.gecko ?? {};
const requiredData = new Set(
  gecko.data_collection_permissions?.required ?? []
);

expect(
  gecko.id === "watch-home@Kvazac",
  "Firefox add-on ID must remain watch-home@Kvazac."
);
expect(
  gecko.update_url ===
    "https://kvazac.github.io/Watch-Home/updates.json",
  "Firefox update_url changed unexpectedly."
);
expect(
  manifest.incognito === "not_allowed",
  "Private browsing must remain disabled for v1."
);
expect(
  Array.isArray(manifest.permissions) &&
    manifest.permissions.length === 1 &&
    manifest.permissions[0] === "storage",
  "Only the storage WebExtension permission is expected."
);
expect(
  manifest.host_permissions?.includes("https://www.netflix.com/*"),
  "Netflix host permission is required."
);
expect(
  manifest.host_permissions?.includes(
    "https://watch-home.ugnius-socials.workers.dev/*"
  ),
  "Exact production Worker host permission is required."
);
expect(
  !manifest.host_permissions?.includes("<all_urls>"),
  "The extension must not request all-sites access."
);
expect(
  requiredData.has("browsingActivity") &&
    requiredData.has("websiteActivity"),
  "Mozilla data collection declarations must include browsingActivity and websiteActivity."
);

const files = await walk(extensionRoot);
const executableFiles = files.filter((file) =>
  /\.(?:js|html)$/i.test(file)
);

for (const file of executableFiles) {
  const content = await fs.readFile(file, "utf8");
  const relative = path.relative(process.cwd(), file);

  expect(
    !/\beval\s*\(/.test(content),
    `${relative} must not use eval().`
  );
  expect(
    !/\bnew\s+Function\s*\(/.test(content),
    `${relative} must not use new Function().`
  );

  if (/\.html$/i.test(file)) {
    expect(
      !/<script[^>]+src=["']https?:\/\//i.test(content),
      `${relative} must not load remote scripts.`
    );
  }
}

if (failures.length > 0) {
  console.error("Compliance check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Compliance check passed.");

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

async function walk(directory) {
  const output = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const target = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      output.push(...(await walk(target)));
    } else {
      output.push(target);
    }
  }

  return output;
}
