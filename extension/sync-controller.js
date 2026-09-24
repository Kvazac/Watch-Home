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
      this.localControlUntil = 0;
      this.hardCorrectionCooldownUntil = 0;
      this.correctionActive = false;
      this.withinExitBandSince = null;
      this.playLatencyMs = DEFAULT_PLAY_LATENCY_MS;
      this.seekLatencyMs = DEFAULT_SEEK_LATENCY_MS;
      this.pendingPlayStartedAt = null;
      this.pendingSeekStartedAt = null;
      this.hardCorrectionCount = 0;
      this.softCorrectionCount = 0;
      this.lastCorrectionAt = null;
      this.lastDiagnostics = this.emptyDiagnostics("idle");

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

      this.restoreCanonicalRate();
      this.localControlUntil = 0;
      this.latestState = null;
      this.lastDiagnostics = this.emptyDiagnostics("idle");
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

    beginLocalControl(durationMs = 900) {
      const duration = Number.isFinite(durationMs)
        ? Math.max(200, Math.min(2000, durationMs))
        : 900;

      this.localControlUntil = performance.now() + duration;
      this.restoreCanonicalRate();
    }

    cancelLocalControl() {
      this.localControlUntil = 0;
    }

    isSuppressingLocalEvents() {
      return performance.now() < this.remoteActionUntil;
    }

    predictPosition(state, additionalLatencyMs = 0) {
      return globalThis.WatchHomeSyncMath.predictPosition(
        state,
        Date.now() + this.clockOffsetMs,
        additionalLatencyMs
      );
    }

    getDiagnostics() {
      return {
        ...this.lastDiagnostics,
        playLatencyMs: Math.round(this.playLatencyMs),
        seekLatencyMs: Math.round(this.seekLatencyMs),
        hardCorrectionCount: this.hardCorrectionCount,
        softCorrectionCount: this.softCorrectionCount,
        lastCorrectionAt: this.lastCorrectionAt,
        sequence: this.latestState?.sequence ?? null
      };
    }

    tick(force = false) {
      const state = this.latestState;
      const video = this.player.getVideo();

      if (!state || !video) {
        this.lastDiagnostics = this.emptyDiagnostics(
          video ? "waiting-for-room-state" : "waiting-for-video"
        );
        return;
      }

      if (state.watchId !== this.player.getWatchId()) {
        this.lastDiagnostics = this.createDiagnostics(
          "wrong-title",
          video,
          state
        );
        return;
      }

      if (performance.now() < this.localControlUntil) {
        const predictedPosition = this.predictPosition(state);
        const driftSeconds = predictedPosition - video.currentTime;

        this.lastDiagnostics = this.createDiagnostics(
          "local-control",
          video,
          state,
          predictedPosition,
          driftSeconds
        );
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
      const hardCorrectionAvailable =
        performance.now() >= this.hardCorrectionCooldownUntil;

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.lastDiagnostics = this.createDiagnostics(
          "local-buffering",
          video,
          state,
          targetNow,
          driftSeconds
        );
        return;
      }

      const decision = globalThis.WatchHomeSyncMath.chooseCorrection(
        driftSeconds,
        {
          force,
          videoPaused: video.paused,
          hardCorrectionAvailable
        }
      );

      if (decision.kind === "hard") {
        this.performPredictiveRecovery(state, video);
        return;
      }

      if (decision.kind === "settled") {
        if (this.withinExitBandSince === null) {
          this.withinExitBandSince = performance.now();
        }

        if (
          this.correctionActive &&
          performance.now() - this.withinExitBandSince >= 1000
        ) {
          this.restoreCanonicalRate();
        }

        this.lastDiagnostics = this.createDiagnostics(
          this.correctionActive ? "settling" : "in-sync",
          video,
          state,
          targetNow,
          driftSeconds
        );
        return;
      }

      this.withinExitBandSince = null;

      if (decision.kind === "ignore") {
        this.lastDiagnostics = this.createDiagnostics(
          "in-sync",
          video,
          state,
          targetNow,
          driftSeconds
        );
        return;
      }

      const targetRate = state.playbackRate * decision.rateMultiplier;
      const alreadyCorrecting =
        this.correctionActive &&
        Math.abs(video.playbackRate - targetRate) < 0.002;

      this.remoteActionUntil = performance.now() + 300;
      this.player.setPlaybackRate(targetRate);
      this.correctionActive = true;

      if (!alreadyCorrecting) {
        this.softCorrectionCount += 1;
        this.lastCorrectionAt = Date.now();
      }

      this.lastDiagnostics = this.createDiagnostics(
        decision.kind,
        video,
        state,
        targetNow,
        driftSeconds
      );
    }

    synchronizeStopped(video, state) {
      const target = state.position;
      const driftSeconds = target - video.currentTime;
      const mode =
        state.mode === "offline"
          ? "host-offline"
          : state.mode === "stalled"
            ? "host-buffering"
            : "paused-sync";

      this.restoreCanonicalRate();

      if (!video.paused) {
        this.remoteActionUntil = performance.now() + 350;
        this.player.pause();
      }

      if (Math.abs(driftSeconds) > 0.08) {
        this.remoteActionUntil = performance.now() + 650;
        this.pendingSeekStartedAt = performance.now();
        this.player.seek(target);
      }

      this.lastDiagnostics = this.createDiagnostics(
        mode,
        video,
        state,
        target,
        driftSeconds
      );
    }

    performPredictiveRecovery(state, video) {
      const targetNow = this.predictPosition(state);
      const needsSeek = Math.abs(targetNow - video.currentTime) > 0.08;
      const expectedLatencyMs = Math.max(
        50,
        Math.min(
          900,
          (needsSeek ? this.seekLatencyMs : 0) +
            (video.paused ? this.playLatencyMs : 0)
        )
      );
      const predictiveTarget = this.predictPosition(
        state,
        expectedLatencyMs
      );

      this.remoteActionUntil = performance.now() + 1500;
      this.hardCorrectionCooldownUntil = performance.now() + 1500;
      this.hardCorrectionCount += 1;
      this.lastCorrectionAt = Date.now();

      if (Math.abs(predictiveTarget - video.currentTime) > 0.08) {
        this.pendingSeekStartedAt = performance.now();
        this.player.seek(predictiveTarget);
      }

      this.restoreCanonicalRate();

      if (video.paused) {
        void this.requestPlay();
      }

      this.lastDiagnostics = this.createDiagnostics(
        "hard-seek",
        video,
        state,
        predictiveTarget,
        predictiveTarget - video.currentTime
      );
    }

    async requestPlay() {
      this.remoteActionUntil = performance.now() + 1000;
      this.pendingPlayStartedAt = performance.now();

      try {
        await this.player.play();
      } catch (error) {
        this.onError?.(
          "Firefox blocked synchronized playback. Click Play once in Netflix, then Watch Home will keep it synchronized."
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
      if (this.latestState) {
        this.remoteActionUntil = performance.now() + 250;
        this.player.setPlaybackRate(this.latestState.playbackRate);
      }

      this.correctionActive = false;
      this.withinExitBandSince = null;
    }

    emptyDiagnostics(mode) {
      return {
        mode,
        localPosition: null,
        predictedPosition: null,
        driftMs: null,
        localRate: null,
        canonicalRate: null,
        readyState: null,
        paused: null
      };
    }

    createDiagnostics(
      mode,
      video,
      state,
      predictedPosition = null,
      driftSeconds = null
    ) {
      return {
        mode,
        localPosition: Number.isFinite(video?.currentTime)
          ? video.currentTime
          : null,
        predictedPosition: Number.isFinite(predictedPosition)
          ? predictedPosition
          : null,
        driftMs: Number.isFinite(driftSeconds)
          ? Math.round(driftSeconds * 1000)
          : null,
        localRate: Number.isFinite(video?.playbackRate)
          ? video.playbackRate
          : null,
        canonicalRate: Number.isFinite(state?.playbackRate)
          ? state.playbackRate
          : null,
        readyState: video?.readyState ?? null,
        paused: video?.paused ?? null
      };
    }
  }

  globalThis.WatchHomeSyncController = SyncController;
})();
