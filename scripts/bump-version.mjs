import fs from "node:fs/promises";

const args = process.argv.slice(2);
const bumpType = readArgument("--type") ?? "patch";
const customVersion = readArgument("--version");

const manifestPath = "extension/manifest.json";
const packagePath = "package.json";
const lockPath = "package-lock.json";

const manifest = JSON.parse(
  await fs.readFile(manifestPath, "utf8")
);

const packageJson = JSON.parse(
  await fs.readFile(packagePath, "utf8")
);

const packageLock = JSON.parse(
  await fs.readFile(lockPath, "utf8")
);

const currentVersion = manifest.version;

if (!isValidVersion(currentVersion)) {
  fail(`Invalid current manifest version: ${currentVersion}`);
}

if (packageJson.version !== currentVersion) {
  fail(
    `Version mismatch: manifest=${currentVersion}, package.json=${packageJson.version}`
  );
}

const nextVersion =
  bumpType === "custom"
    ? validateCustomVersion(customVersion)
    : incrementVersion(currentVersion, bumpType);

manifest.version = nextVersion;
packageJson.version = nextVersion;
packageLock.version = nextVersion;

if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = nextVersion;
}

await fs.writeFile(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

await fs.writeFile(
  packagePath,
  `${JSON.stringify(packageJson, null, 2)}\n`,
  "utf8"
);

await fs.writeFile(
  lockPath,
  `${JSON.stringify(packageLock, null, 2)}\n`,
  "utf8"
);

console.log(`Version bumped: ${currentVersion} -> ${nextVersion}`);

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(
    process.env.GITHUB_OUTPUT,
    `version=${nextVersion}\n`,
    "utf8"
  );
}

function incrementVersion(version, type) {
  const [major, minor, patch] = version
    .split(".")
    .map(Number);

  switch (type) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`;

    case "minor":
      return `${major}.${minor + 1}.0`;

    case "major":
      return `${major + 1}.0.0`;

    default:
      fail(
        `Unsupported bump type "${type}". Use patch, minor, major, or custom.`
      );
  }
}

function validateCustomVersion(version) {
  if (!isValidVersion(version)) {
    fail(
      `Invalid custom version "${version}". Expected x.y.z, for example 1.2.3.`
    );
  }

  return version;
}

function isValidVersion(version) {
  return /^\d+\.\d+\.\d+$/.test(version ?? "");
}

function readArgument(name) {
  const index = args.indexOf(name);

  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
