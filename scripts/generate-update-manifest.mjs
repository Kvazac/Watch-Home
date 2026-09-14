import crypto from "node:crypto";
import fs from "node:fs/promises";

const [version, xpiPath, updateLink] = process.argv.slice(2);

if (!version || !xpiPath || !updateLink) {
  console.error(
    "Usage: node scripts/generate-update-manifest.mjs <version> <xpi-path> <https-update-link>"
  );
  process.exit(1);
}

const xpi = await fs.readFile(xpiPath);
const sha256 = crypto.createHash("sha256").update(xpi).digest("hex");

const manifest = {
  addons: {
    "watch-home@Kvazac": {
      updates: [
        {
          version,
          update_link: updateLink,
          update_hash: `sha256:${sha256}`
        }
      ]
    }
  }
};

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
