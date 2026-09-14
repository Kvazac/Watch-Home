import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const config = JSON.parse(
  await readFile(resolve(repositoryRoot, "project.config.json"), "utf8"),
);

const args = parseArgs(process.argv.slice(2));
for (const key of ["version", "url", "hash", "out"]) {
  if (!args[key]) {
    throw new Error(`Missing --${key}.`);
  }
}

if (!/^https:\/\//.test(args.url)) {
  throw new Error("--url must use HTTPS.");
}

if (!/^[a-f0-9]{64}$/i.test(args.hash)) {
  throw new Error("--hash must be a SHA-256 hex digest.");
}

const manifest = {
  addons: {
    [config.extensionId]: {
      updates: [
        {
          version: args.version,
          update_link: args.url,
          update_hash: `sha256:${args.hash.toLowerCase()}`,
          applications: {
            gecko: {
              strict_min_version: "140.0",
            },
          },
        },
      ],
    },
  },
};

const outputPath = resolve(repositoryRoot, args.out);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${args.out}`);

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}
