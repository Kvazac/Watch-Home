"use strict";

(() => {
  const DEFAULT_PLAY_LATENCY_MS = 180;
  const DEFAULT_SEEK_LATENCY_MS = 220;

  class SyncController {
    constructor(player, onError) {
      this.player = player;
      this.onError = onError;
      this.latestState = null;
      this.clockOffsetMs = 0;
      this.tickTimer = null;
      this.remoteActionUntil = 0;
      this.hardCorrectionCooldownUntil = 0;
      this.correctionActive = false;
      this.withinExitBandSince = null;
      this.playLatencyMs = DEFAULT_PLAY_LATENCY_MS;
      this.seekLatencyMs = DEFAULT_SEEK_LATENCY_MS;
      this.pendingPlayStartedAt = null;
      this.pendingSeekStartedAt = null;

      this.player.on("playing", () => this.observePlaying());
      this.player.on("seeked", () => this.observeSeeked());
    }

    start() {
      if (this.tickTimer !== null) {
        return;
      }

      this.tickTimer = window.setInterval(() => this.tick(), 250);
    }

    stop() {
      if (this.tickTimer !== null) {
        window.clearInterval(this.tickTimer);
        this.tickTimer = null;
      }

      this.latestState = null;
      this.restoreCanonicalRate();
    }

    applyRoomState(state, clockOffsetMs) {
      if (!state) {
        return;
      }

      this.latestState = state;
      this.clockOffsetMs = Number.isFinite(clockOffsetMs)
        ? clockOffsetMs
        : this.clockOffsetMs;
      this.tick(true);
    }

    updateClockOffset(clockOffsetMs) {
      if (Number.isFinite(clockOffsetMs)) {
        this.clockOffsetMs = clockOffsetMs;
      }
    }

    reapplyNow() {
      this.tick(true);
    }

    isSuppressingLocalEvents() {
      return performance.now() < this.remoteActionUntil;
    }

    predictPosition(state, additionalLatencyMs = 0) {
      if (!state) {
        return 0;
      }

      if (state.mode !== "playing") {
        return state.position;
      }

      const estimatedServerNow = Date.now() + this.clockOffsetMs;
      const elapsedMs = Math.max(
        0,
        estimatedServerNow + additionalLatencyMs - state.anchorServerTime
      );

      return state.position + (elapsedMs / 1000) * state.playbackRate;
    }

    tick(force = false) {
      const state = this.latestState;
      const video = this.player.getVideo();

      if (!state || !video) {
        return;
      }

      if (state.watchId !== this.player.getWatchId()) {
        return;
      }

      if (state.mode === "playing") {
        this.synchronizePlaying(video, state, force);
        return;
      }

      this.synchronizeStopped(video, state);
    }

    synchronizePlaying(video, state, force) {
      const targetNow = this.predictPosition(state);
      const driftSeconds = targetNow - video.currentTime;
      const absoluteDrift = Math.abs(driftSeconds);

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      if (
        performance.now() >= this.hardCorrectionCooldownUntil &&
        (video.paused || absoluteDrift > 1.5)
      ) {
        this.performPredictiveRecovery(state, video);
        return;
      }

      if (video.paused) {
        this.requestPlay();
        return;
      }

      if (absoluteDrift < 0.07) {
        if (this.withinExitBandSince === null) {
          this.withinExitBandSince = performance.now();
        }

        if (
          this.correctionActive &&
          performance.now() - this.withinExitBandSince >= 1000
        ) {
          this.restoreCanonicalRate();
        }
        return;
      }

      this.withinExitBandSince = null;

      if (absoluteDrift < 0.12 && !force) {
        return;
      }

      const correction = this.correctionMagnitude(absoluteDrift);
      const direction = Math.sign(driftSeconds);
      const targetRate = state.playbackRate * (1 + direction * correction);

      this.remoteActionUntil = performance.now() + 300;
      this.player.setPlaybackRate(targetRate);
      this.correctionActive = true;
    }

    synchronizeStopped(video, state) {
      const target = state.position;
      const driftSeconds = target - video.currentTime;

      this.restoreCanonicalRate();

      if (!video.paused) {
        this.remoteActionUntil = performance.now() + 300;
        this.player.pause();
      }

      if (Math.abs(driftSeconds) > 0.08) {
        this.remoteActionUntil = performance.now() + 500;
        this.pendingSeekStartedAt = performance.now();
        this.player.seek(target);
      }
    }

    correctionMagnitude(absoluteDrift) {
      if (absoluteDrift < 0.4) {
        return 0.025;
      }

      if (absoluteDrift < 0.9) {
        return 0.05;
      }

      return 0.075;
    }

    performPredictiveRecovery(state, video) {
      const expectedLatencyMs = Math.max(
        100,
        Math.min(700, this.seekLatencyMs + (video.paused ? this.playLatencyMs : 0))
      );
      const predictiveTarget = this.predictPosition(state, expectedLatencyMs);

      this.remoteActionUntil = performance.now() + 1200;
      this.hardCorrectionCooldownUntil = performance.now() + 1200;
      this.pendingSeekStartedAt = performance.now();

      if (Math.abs(predictiveTarget - video.currentTime) > 0.08) {
        this.player.seek(predictiveTarget);
      }

      this.restoreCanonicalRate();

      if (video.paused) {
        this.requestPlay();
      }
    }

    async requestPlay() {
      this.remoteActionUntil = performance.now() + 800;
      this.pendingPlayStartedAt = performance.now();

      try {
        await this.player.play();
      } catch (error) {
        this.onError?.(
          "Firefox blocked remote playback. Click Play once in Netflix, then retry."
        );
        console.warn("Watch Home could not start playback", error);
      }
    }

    observePlaying() {
      if (this.pendingPlayStartedAt === null) {
        return;
      }

      const sample = performance.now() - this.pendingPlayStartedAt;
      this.playLatencyMs = this.ema(this.playLatencyMs, sample);
      this.pendingPlayStartedAt = null;
    }

    observeSeeked() {
      if (this.pendingSeekStartedAt === null) {
        return;
      }

      const sample = performance.now() - this.pendingSeekStartedAt;
      this.seekLatencyMs = this.ema(this.seekLatencyMs, sample);
      this.pendingSeekStartedAt = null;
    }

    ema(previous, sample) {
      const bounded = Math.max(20, Math.min(1500, sample));
      return previous * 0.75 + bounded * 0.25;
    }

    restoreCanonicalRate() {
      if (!this.latestState) {
        return;
      }

      this.remoteActionUntil = performance.now() + 250;
      this.player.setPlaybackRate(this.latestState.playbackRate);
      this.correctionActive = false;
      this.withinExitBandSince = null;
    }
  }

  globalThis.WatchHomeSyncController = SyncController;
})();
