"use strict";

(() => {
  const DEFAULT_THRESHOLDS = Object.freeze({
    settledSeconds: 0.07,
    ignoreSeconds: 0.12,
    hardSeekSeconds: 1.5
  });

  function predictPosition(state, serverNowMs, additionalLatencyMs = 0) {
    if (!state || !Number.isFinite(state.position)) {
      return 0;
    }

    if (state.mode !== "playing") {
      return state.position;
    }

    const anchorServerTime = Number(state.anchorServerTime);
    const playbackRate = Number(state.playbackRate);

    if (!Number.isFinite(anchorServerTime) || !Number.isFinite(playbackRate)) {
      return state.position;
    }

    const elapsedMs = Math.max(
      0,
      Number(serverNowMs) + Number(additionalLatencyMs) - anchorServerTime
    );

    return state.position + (elapsedMs / 1000) * playbackRate;
  }

  function correctionMagnitude(absoluteDriftSeconds) {
    if (absoluteDriftSeconds < 0.4) {
      return 0.025;
    }

    if (absoluteDriftSeconds < 0.9) {
      return 0.05;
    }

    return 0.075;
  }

  function chooseCorrection(
    driftSeconds,
    {
      force = false,
      videoPaused = false,
      hardCorrectionAvailable = true,
      thresholds = DEFAULT_THRESHOLDS
    } = {}
  ) {
    const absoluteDrift = Math.abs(driftSeconds);

    if (
      hardCorrectionAvailable &&
      (videoPaused || absoluteDrift > thresholds.hardSeekSeconds)
    ) {
      return {
        kind: "hard",
        rateMultiplier: 1
      };
    }

    if (absoluteDrift < thresholds.settledSeconds) {
      return {
        kind: "settled",
        rateMultiplier: 1
      };
    }

    if (!force && absoluteDrift < thresholds.ignoreSeconds) {
      return {
        kind: "ignore",
        rateMultiplier: 1
      };
    }

    const magnitude = correctionMagnitude(absoluteDrift);
    const direction = Math.sign(driftSeconds);

    return {
      kind: direction >= 0 ? "soft-catch-up" : "soft-slow-down",
      rateMultiplier: 1 + direction * magnitude
    };
  }

  function selectClockEstimate(samples, preferredCount = 3) {
    const validSamples = (samples ?? []).filter(
      (sample) =>
        Number.isFinite(sample?.rtt) &&
        sample.rtt >= 0 &&
        Number.isFinite(sample?.offset)
    );

    if (validSamples.length === 0) {
      return {
        offsetMs: 0,
        rttMs: null
      };
    }

    const preferred = [...validSamples]
      .sort((left, right) => left.rtt - right.rtt)
      .slice(0, Math.max(1, Math.min(preferredCount, validSamples.length)));

    return {
      offsetMs:
        preferred.reduce((sum, sample) => sum + sample.offset, 0) /
        preferred.length,
      rttMs:
        preferred.reduce((sum, sample) => sum + sample.rtt, 0) /
        preferred.length
    };
  }

  function isNewerSequence(currentSequence, incomingSequence) {
    if (!Number.isFinite(incomingSequence)) {
      return true;
    }

    if (!Number.isFinite(currentSequence)) {
      return true;
    }

    return incomingSequence > currentSequence;
  }

  globalThis.WatchHomeSyncMath = Object.freeze({
    DEFAULT_THRESHOLDS,
    chooseCorrection,
    correctionMagnitude,
    isNewerSequence,
    predictPosition,
    selectClockEstimate
  });
})();
