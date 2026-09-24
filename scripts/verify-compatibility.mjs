import fs from "node:fs/promises";

import {
  PROTOCOL_VERSION,
  SERVER_RELEASE,
  SUPPORTED_CLIENT_VERSIONS
} from "../worker/src/compatibility.js";

const manifest = JSON.parse(
  await fs.readFile("extension/manifest.json", "utf8")
);
const protocolSource = await fs.readFile(
  "extension/shared/protocol.js",
  "utf8"
);

const protocolMatch = protocolSource.match(
  /const PROTOCOL_VERSION = (\d+);/
);
const extensionProtocol = Number(protocolMatch?.[1]);

if (manifest.version !== SERVER_RELEASE) {
  fail(
    `Manifest ${manifest.version} does not match server release ${SERVER_RELEASE}.`
  );
}

if (!SUPPORTED_CLIENT_VERSIONS.includes(manifest.version)) {
  fail(
    `Manifest ${manifest.version} is not listed in supported client versions.`
  );
}

if (extensionProtocol !== PROTOCOL_VERSION) {
  fail(
    `Extension protocol ${extensionProtocol} does not match worker protocol ${PROTOCOL_VERSION}.`
  );
}

console.log(
  `Local compatibility OK: extension ${manifest.version}, protocol ${PROTOCOL_VERSION}.`
);

if (process.argv.includes("--remote")) {
  const configSource = await fs.readFile(
    "extension/config.js",
    "utf8"
  );
  const backendMatch = configSource.match(
    /backendHttpOrigin:\s*"([^"]+)"/
  );

  if (!backendMatch) {
    fail("Could not read backendHttpOrigin from extension/config.js.");
  }

  const healthUrl = `${backendMatch[1]}/health`;
  const response = await fetch(healthUrl, {
    headers: {
      "cache-control": "no-cache"
    }
  });

  if (!response.ok) {
    fail(`Remote health check failed with HTTP ${response.status}.`);
  }

  const health = await response.json();

  if (Number(health.protocol) !== PROTOCOL_VERSION) {
    fail(
      `Remote protocol ${health.protocol ?? "unknown"} does not match ${PROTOCOL_VERSION}.`
    );
  }

  if (health.release !== SERVER_RELEASE) {
    fail(
      `Remote release ${health.release ?? "unknown"} does not match ${SERVER_RELEASE}.`
    );
  }

  if (
    !Array.isArray(health.supportedClientVersions) ||
    !health.supportedClientVersions.includes(manifest.version)
  ) {
    fail(
      `Remote server does not advertise support for client ${manifest.version}.`
    );
  }

  console.log(
    `Remote compatibility OK: ${healthUrl}, release ${health.release}, protocol ${health.protocol}.`
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
