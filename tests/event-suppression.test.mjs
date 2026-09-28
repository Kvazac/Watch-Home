import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

globalThis.HTMLMediaElement = {
  HAVE_CURRENT_DATA: 2
};

globalThis.WatchHomeSyncMath = {
  predictPosition(state) {
    return state.position;
  },
  chooseCorrection() {
    return {
      kind: "settled",
      rateMultiplier: 1
    };
  }
};

await import("../extension/sync-controller.js");

const SyncController = globalThis.WatchHomeSyncController;

class FakePlayer {
  constructor({
    paused = true,
    playbackRate = 1,
    currentTime = 10
  } = {}) {
    this.video = {
      paused,
      playbackRate,
      currentTime,
      readyState: 4
    };
    this.watchId = "81234567";
    this.listeners = new Map();
    this.pauseCalls = 0;
    this.rateCalls = 0;
  }

  on(eventName, callback) {
    this.listeners.set(eventName, callback);
  }

  getVideo() {
    return this.video;
  }

  getWatchId() {
    return this.watchId;
  }

  pause() {
    this.pauseCalls += 1;
    this.video.paused = true;
  }

  seek(position) {
    this.video.currentTime = position;
  }

  setPlaybackRate(rate) {
    this.rateCalls += 1;
    this.video.playbackRate = rate;
  }

  async play() {
    this.video.paused = false;
  }
}

function pausedState(overrides = {}) {
  return {
    watchId: "81234567",
    position: 10,
    playbackRate: 1,
    mode: "paused",
    anchorServerTime: Date.now(),
    sequence: 1,
    ...overrides
  };
}

test("paused canonical sync never suppresses a genuine local play event", () => {
  const player = new FakePlayer({ paused: true });
  const controller = new SyncController(player);

  controller.applyRoomState(pausedState(), 0);

  for (let index = 0; index < 5; index += 1) {
    controller.tick();
  }

  assert.equal(
    controller.isSuppressingLocalEvents("play"),
    false
  );
});

test("remote pause suppresses only the matching pause event", () => {
  const player = new FakePlayer({ paused: false });
  const controller = new SyncController(player);

  controller.applyRoomState(pausedState(), 0);

  assert.equal(player.pauseCalls, 1);
  assert.equal(
    controller.isSuppressingLocalEvents("play"),
    false
  );
  assert.equal(
    controller.isSuppressingLocalEvents("pause"),
    true
  );
  assert.equal(
    controller.isSuppressingLocalEvents("pause"),
    false
  );
});

test("remote rate correction cannot mask play or pause", () => {
  const player = new FakePlayer({
    paused: true,
    playbackRate: 1.25
  });
  const controller = new SyncController(player);

  controller.applyRoomState(pausedState(), 0);

  assert.equal(player.rateCalls, 1);
  assert.equal(player.video.playbackRate, 1);
  assert.equal(
    controller.isSuppressingLocalEvents("play"),
    false
  );
  assert.equal(
    controller.isSuppressingLocalEvents("pause"),
    false
  );
  assert.equal(
    controller.isSuppressingLocalEvents("ratechange"),
    true
  );
});

test("content script uses event-specific remote feedback suppression", async () => {
  const source = await fs.readFile(
    "extension/content.js",
    "utf8"
  );

  assert.match(
    source,
    /isSuppressingLocalEvents\(reason\)/
  );
  assert.match(
    source,
    /isSuppressingLocalEvents\("playing"\)/
  );
  assert.doesNotMatch(
    source,
    /isSuppressingLocalEvents\(\)/
  );
});
