import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const sourceDirectory = resolve(repositoryRoot, "extension-src");
const outputDirectory = resolve(repositoryRoot, "build", "extension");

const projectConfig = JSON.parse(
  await readFile(resolve(repositoryRoot, "project.config.json"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
);

validateConfig(projectConfig);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDirectory, outputDirectory, { recursive: true });

const backendOrigin = projectConfig.backendOrigin.replace(/\/+$/, "");
const backendWsOrigin = backendOrigin.replace(/^https:/, "wss:");

const manifestTemplatePath = resolve(
  outputDirectory,
  "manifest.template.json",
);
const manifestTemplate = await readFile(manifestTemplatePath, "utf8");
const manifest = replaceAll(manifestTemplate, {
  "__VERSION__": packageJson.version,
  "__EXTENSION_ID__": projectConfig.extensionId,
  "__UPDATE_URL__": projectConfig.updateUrl,
  "__BACKEND_ORIGIN__": backendOrigin,
  "__BACKEND_WS_ORIGIN__": backendWsOrigin,
});

await writeFile(resolve(outputDirectory, "manifest.json"), manifest);
await rm(manifestTemplatePath);

const configTemplatePath = resolve(outputDirectory, "config.template.js");
const configTemplate = await readFile(configTemplatePath, "utf8");
const runtimeConfig = replaceAll(configTemplate, {
  "__BACKEND_ORIGIN__": backendOrigin,
});

await writeFile(resolve(outputDirectory, "config.js"), runtimeConfig);
await rm(configTemplatePath);

console.log(`Built extension ${packageJson.version} in build/extension`);

function replaceAll(input, replacements) {
  let output = input;
  for (const [needle, value] of Object.entries(replacements)) {
    output = output.replaceAll(needle, value);
  }
  return output;
}

function validateConfig(config) {
  if (!config.extensionId || !config.updateUrl || !config.backendOrigin) {
    throw new Error("project.config.json is missing required values.");
  }

  if (config.backendOrigin.includes("REPLACE-ME")) {
    throw new Error(
      "Set backendOrigin in project.config.json after the first Cloudflare deployment.",
    );
  }

  const backend = new URL(config.backendOrigin);
  const update = new URL(config.updateUrl);

  if (backend.protocol !== "https:") {
    throw new Error("backendOrigin must use HTTPS.");
  }

  if (update.protocol !== "https:") {
    throw new Error("updateUrl must use HTTPS.");
  }
}
