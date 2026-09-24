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

test("v1.2.0 compatibility constants stay aligned", async () => {
  const manifest = JSON.parse(
    await fs.readFile("extension/manifest.json", "utf8")
  );
  const protocolSource = await fs.readFile(
    "extension/shared/protocol.js",
    "utf8"
  );

  assert.equal(PROTOCOL_VERSION, 2);
  assert.equal(SERVER_RELEASE, "1.2.0");
  assert.deepEqual(SUPPORTED_CLIENT_VERSIONS, ["1.2.0"]);
  assert.equal(manifest.version, "1.2.0");
  assert.match(
    protocolSource,
    /const PROTOCOL_VERSION = 2;/
  );
});

test("matching protocol and client version are accepted", () => {
  assert.deepEqual(
    checkClientCompatibility("2", "1.2.0"),
    {
      ok: true,
      protocolVersion: 2,
      clientVersion: "1.2.0"
    }
  );
});

test("protocol mismatch is terminal", () => {
  const result = checkClientCompatibility("1", "1.2.0");

  assert.equal(result.ok, false);
  assert.equal(result.code, "PROTOCOL_MISMATCH");
  assert.equal(result.closeCode, 4406);
});

test("unsupported client version is terminal", () => {
  const result = checkClientCompatibility("2", "1.1.6");

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


test("room version lock accepts the host version and rejects mixed versions", () => {
  assert.deepEqual(
    checkRoomClientCompatibility("1.2.0", "1.2.0"),
    {
      ok: true,
      roomClientVersion: "1.2.0",
      clientVersion: "1.2.0"
    }
  );

  const mismatch = checkRoomClientCompatibility("1.2.0", "1.2.1");
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, "ROOM_CLIENT_VERSION_MISMATCH");
  assert.equal(mismatch.closeCode, 4409);
});
