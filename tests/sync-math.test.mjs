import assert from "node:assert/strict";
import test from "node:test";

await import("../extension/shared/sync-math.js");

const {
  chooseCorrection,
  isNewerSequence,
  predictPosition,
  selectClockEstimate
} = globalThis.WatchHomeSyncMath;

test("prediction advances a playing canonical timeline", () => {
  const position = predictPosition(
    {
      mode: "playing",
      position: 100,
      playbackRate: 1,
      anchorServerTime: 10_000
    },
    12_500
  );

  assert.equal(position, 102.5);
});

test("prediction freezes paused and stalled states", () => {
  assert.equal(
    predictPosition(
      {
        mode: "paused",
        position: 50,
        playbackRate: 1,
        anchorServerTime: 10_000
      },
      20_000
    ),
    50
  );

  assert.equal(
    predictPosition(
      {
        mode: "stalled",
        position: 51,
        playbackRate: 1,
        anchorServerTime: 10_000
      },
      20_000
    ),
    51
  );
});

test("prediction includes expected recovery latency", () => {
  const position = predictPosition(
    {
      mode: "playing",
      position: 10,
      playbackRate: 1,
      anchorServerTime: 1_000
    },
    2_000,
    250
  );

  assert.equal(position, 11.25);
});

test("small drift does not cause correction churn", () => {
  assert.equal(
    chooseCorrection(0.05).kind,
    "settled"
  );
  assert.equal(
    chooseCorrection(0.09).kind,
    "ignore"
  );
});

test("medium drift uses rate correction", () => {
  const behind = chooseCorrection(0.3);
  const ahead = chooseCorrection(-0.3);

  assert.equal(behind.kind, "soft-catch-up");
  assert.ok(behind.rateMultiplier > 1);

  assert.equal(ahead.kind, "soft-slow-down");
  assert.ok(ahead.rateMultiplier < 1);
});

test("large drift or pause requests a hard recovery", () => {
  assert.equal(
    chooseCorrection(2).kind,
    "hard"
  );
  assert.equal(
    chooseCorrection(0.2, { videoPaused: true }).kind,
    "hard"
  );
});

test("clock estimate favors low RTT samples", () => {
  const estimate = selectClockEstimate([
    { rtt: 40, offset: 10 },
    { rtt: 35, offset: 12 },
    { rtt: 200, offset: 100 },
    { rtt: 38, offset: 11 }
  ]);

  assert.equal(estimate.offsetMs, 11);
  assert.equal(estimate.rttMs, 113 / 3);
});

test("sequence guard rejects stale canonical state", () => {
  assert.equal(isNewerSequence(10, 11), true);
  assert.equal(isNewerSequence(10, 10), false);
  assert.equal(isNewerSequence(10, 9), false);
});
