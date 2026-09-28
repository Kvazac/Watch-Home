import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

async function read(relative) {
  return fs.readFile(relative, "utf8");
}

test("shared controls are wired end-to-end", async () => {
  const [
    protocol,
    content,
    syncController,
    background,
    popupHtml,
    popupJs,
    partyRoom
  ] = await Promise.all([
    read("extension/shared/protocol.js"),
    read("extension/content.js"),
    read("extension/sync-controller.js"),
    read("extension/background.js"),
    read("extension/popup/popup.html"),
    read("extension/popup/popup.js"),
    read("worker/src/party-room.js")
  ]);

  assert.match(protocol, /CONTROL_STATE/);
  assert.match(protocol, /SET_CONTROL_MODE/);
  assert.match(protocol, /ROOM_SETTINGS/);

  assert.match(content, /controller\.beginLocalControl\(\)/);
  assert.match(content, /type:\s*MessageType\.CONTROL_STATE/);
  assert.match(content, /MessageType\.ROOM_SETTINGS/);

  assert.match(syncController, /beginLocalControl\(durationMs = 900\)/);
  assert.match(syncController, /cancelLocalControl\(\)/);
  assert.match(syncController, /performance\.now\(\) < this\.localControlUntil/);

  assert.match(background, /case MessageType\.CONTROL_STATE:/);
  assert.match(background, /POPUP_SET_CONTROL_MODE/);
  assert.match(background, /case MessageType\.ROOM_SETTINGS:/);

  assert.match(popupHtml, /id="control-mode-select"/);
  assert.match(popupJs, /POPUP_SET_CONTROL_MODE/);

  assert.match(partyRoom, /case "CONTROL_STATE":/);
  assert.match(partyRoom, /case "SET_CONTROL_MODE":/);
});

test("compatibility checks are enforced before and during WebSocket use", async () => {
  const [
    protocol,
    background,
    workerIndex,
    compatibility,
    partyRoom
  ] = await Promise.all([
    read("extension/shared/protocol.js"),
    read("extension/background.js"),
    read("worker/src/index.js"),
    read("worker/src/compatibility.js"),
    read("worker/src/party-room.js")
  ]);

  assert.match(protocol, /const PROTOCOL_VERSION = 2;/);
  assert.match(background, /\/health/);
  assert.match(background, /protocolVersion:\s*String\(PROTOCOL_VERSION\)/);
  assert.match(background, /clientVersion:\s*CLIENT_VERSION/);
  assert.match(background, /compatibility-error/);

  assert.match(workerIndex, /supportedClientVersions/);
  assert.match(compatibility, /PROTOCOL_MISMATCH/);
  assert.match(compatibility, /ROOM_CLIENT_VERSION_MISMATCH/);
  assert.match(compatibility, /4406/);
  assert.match(compatibility, /4409/);
  assert.match(partyRoom, /checkClientCompatibility/);
  assert.match(partyRoom, /checkRoomClientCompatibility/);
  assert.match(partyRoom, /roomClientVersion/);
});
