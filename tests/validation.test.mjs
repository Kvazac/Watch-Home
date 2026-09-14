import assert from "node:assert/strict";
import test from "node:test";

import {
  clampAnchorTime,
  freezeCanonicalState,
  isValidClientId,
  isValidRoomId,
  sanitizeHostState
} from "../worker/src/validation.js";

test("room IDs accept the intended 12-character alphabet", () => {
  assert.equal(isValidRoomId("2345ABCDJKMP"), true);
  assert.equal(isValidRoomId("1235ABCDJKMP"), false);
  assert.equal(isValidRoomId("2345ABCDJKM"), false);
});

test("client IDs require UUID v4", () => {
  assert.equal(
    isValidClientId("550e8400-e29b-41d4-a716-446655440000"),
    true
  );
  assert.equal(isValidClientId("not-a-uuid"), false);
});

test("host state validation accepts all canonical modes", () => {
  for (const mode of ["playing", "paused", "stalled", "offline"]) {
    assert.deepEqual(
      sanitizeHostState({
        watchId: "81234567",
        position: 120.5,
        playbackRate: 1,
        mode
      }),
      {
        watchId: "81234567",
        position: 120.5,
        playbackRate: 1,
        mode
      }
    );
  }
});

test("host state validation rejects unsafe values", () => {
  assert.equal(
    sanitizeHostState({
      watchId: "bad",
      position: 120,
      playbackRate: 1,
      mode: "playing"
    }),
    null
  );

  assert.equal(
    sanitizeHostState({
      watchId: "81234567",
      position: -1,
      playbackRate: 1,
      mode: "playing"
    }),
    null
  );

  assert.equal(
    sanitizeHostState({
      watchId: "81234567",
      position: 120,
      playbackRate: 99,
      mode: "playing"
    }),
    null
  );
});

test("anchor time accepts reasonable client clock estimates", () => {
  assert.equal(clampAnchorTime(10_100, 10_000), 10_100);
  assert.equal(clampAnchorTime(20_000, 10_000), 10_000);
});

test("disconnect freezes a playing canonical timeline", () => {
  const frozen = freezeCanonicalState(
    {
      watchId: "81234567",
      position: 100,
      playbackRate: 1,
      mode: "playing",
      anchorServerTime: 10_000,
      sequence: 5
    },
    12_500
  );

  assert.equal(frozen.mode, "offline");
  assert.equal(frozen.position, 102.5);
  assert.equal(frozen.anchorServerTime, 12_500);
});

test("disconnect does not advance an already stopped state", () => {
  const frozen = freezeCanonicalState(
    {
      watchId: "81234567",
      position: 100,
      playbackRate: 1,
      mode: "paused",
      anchorServerTime: 10_000,
      sequence: 5
    },
    12_500
  );

  assert.equal(frozen.mode, "offline");
  assert.equal(frozen.position, 100);
});
