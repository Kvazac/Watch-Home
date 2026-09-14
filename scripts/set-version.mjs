import fs from "node:fs/promises";

const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error(
    "Usage: npm run version:set -- 1.2.3"
  );
  process.exit(1);
}

const manifestPath = "extension/manifest.json";
const packagePath = "package.json";

const manifest = JSON.parse(
  await fs.readFile(manifestPath, "utf8")
);
const packageJson = JSON.parse(
  await fs.readFile(packagePath, "utf8")
);

manifest.version = version;
packageJson.version = version;

await fs.writeFile(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`
);
await fs.writeFile(
  packagePath,
  `${JSON.stringify(packageJson, null, 2)}\n`
);

console.log(`Set Watch Home version to ${version}.`);
