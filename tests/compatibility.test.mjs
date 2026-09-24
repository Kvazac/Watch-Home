import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  PROTOCOL_VERSION,
  SERVER_RELEASE,
  SUPPORTED_CLIENT_VERSIONS,
  checkClientCompatibility,
  checkRoomClientCompatibility
} from "../worker/src/compatibility.js";

const manifest = JSON.parse(
  await fs.readFile("extension/manifest.json", "utf8")
);

test("compatibility metadata stays aligned with the current release", async () => {
  const protocolSource = await fs.readFile(
    "extension/shared/protocol.js",
    "utf8"
  );

  assert.equal(PROTOCOL_VERSION, 2);
  assert.equal(SERVER_RELEASE, manifest.version);
  assert.ok(SUPPORTED_CLIENT_VERSIONS.includes(manifest.version));
  assert.ok(SUPPORTED_CLIENT_VERSIONS.length >= 1);
  assert.ok(SUPPORTED_CLIENT_VERSIONS.length <= 3);
  assert.match(
    protocolSource,
    new RegExp(`const PROTOCOL_VERSION = ${PROTOCOL_VERSION};`)
  );
});

test("matching protocol and current client version are accepted", () => {
  assert.deepEqual(
    checkClientCompatibility(
      String(PROTOCOL_VERSION),
      manifest.version
    ),
    {
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      clientVersion: manifest.version
    }
  );
});

test("protocol mismatch is terminal", () => {
  const result = checkClientCompatibility(
    String(PROTOCOL_VERSION + 1),
    manifest.version
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "PROTOCOL_MISMATCH");
  assert.equal(result.closeCode, 4406);
});

test("unsupported client version is terminal", () => {
  const unsupportedVersion = "999.999.999";
  assert.equal(
    SUPPORTED_CLIENT_VERSIONS.includes(unsupportedVersion),
    false
  );

  const result = checkClientCompatibility(
    String(PROTOCOL_VERSION),
    unsupportedVersion
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "CLIENT_VERSION_MISMATCH");
  assert.equal(result.closeCode, 4409);
});

test("missing compatibility metadata is rejected", () => {
  assert.equal(
    checkClientCompatibility(null, null).ok,
    false
  );
});

test("room version lock accepts same-version clients and rejects mixed versions", () => {
  assert.deepEqual(
    checkRoomClientCompatibility(
      manifest.version,
      manifest.version
    ),
    {
      ok: true,
      roomClientVersion: manifest.version,
      clientVersion: manifest.version
    }
  );

  const differentVersion =
    manifest.version === "999.999.998"
      ? "999.999.997"
      : "999.999.998";

  const mismatch = checkRoomClientCompatibility(
    manifest.version,
    differentVersion
  );

  assert.equal(mismatch.ok, false);
  assert.equal(
    mismatch.code,
    "ROOM_CLIENT_VERSION_MISMATCH"
  );
  assert.equal(mismatch.closeCode, 4409);
});

test("server rollout window may support multiple versions without allowing mixed rooms", () => {
  for (const version of SUPPORTED_CLIENT_VERSIONS) {
    assert.equal(
      checkClientCompatibility(
        String(PROTOCOL_VERSION),
        version
      ).ok,
      true
    );
  }

  if (SUPPORTED_CLIENT_VERSIONS.length > 1) {
    const [first, second] = SUPPORTED_CLIENT_VERSIONS;
    assert.equal(
      checkRoomClientCompatibility(first, second).ok,
      false
    );
  }
});
