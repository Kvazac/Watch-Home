"use strict";

globalThis.WatchHome = globalThis.WatchHome ?? {};

class ClockEstimator {
  constructor() {
    this.samples = [];
  }

  addSample(clientSentAt, clientReceivedAt, serverTime) {
    const sent = Number(clientSentAt);
    const received = Number(clientReceivedAt);
    const server = Number(serverTime);

    if (![sent, received, server].every(Number.isFinite) || received < sent) {
      return;
    }

    const rtt = received - sent;
    const midpoint = sent + rtt / 2;
    const offset = server - midpoint;

    this.samples.push({ rtt, offset });
    this.samples.sort((left, right) => left.rtt - right.rtt);
    this.samples = this.samples.slice(0, 8);
  }

  getOffsetMs() {
    if (this.samples.length === 0) {
      return 0;
    }

    const best = this.samples.slice(0, Math.min(5, this.samples.length));
    const offsets = best.map((sample) => sample.offset).sort((a, b) => a - b);
    return offsets[Math.floor(offsets.length / 2)];
  }

  serverNow() {
    return Date.now() + this.getOffsetMs();
  }
}

function expectedPosition(state, serverTimeMs, projectionMs = 0) {
  if (!state) {
    return 0;
  }

  if (state.paused || state.stalled) {
    return state.anchorPosition;
  }

  const elapsedSeconds =
    Math.max(0, serverTimeMs + projectionMs - state.anchorServerTime) / 1000;

  return state.anchorPosition + elapsedSeconds * state.playbackRate;
}

class SyncController {
  constructor(player, clock) {
    this.player = player;
    this.clock = clock;
    this.state = null;
    this.role = "guest";
    this.timer = null;
    this.recoveryLatencyMs = 220;
    this.pendingRecoveryStartedAt = null;
    this.stableSince = null;

    this.unsubscribe = this.player.subscribe((event) => {
      if (
        event.type === "playing" &&
        this.pendingRecoveryStartedAt !== null
      ) {
        const measured = performance.now() - this.pendingRecoveryStartedAt;
        this.recoveryLatencyMs =
          this.recoveryLatencyMs * 0.8 + Math.min(measured, 2000) * 0.2;
        this.pendingRecoveryStartedAt = null;
      }
    });
  }

  destroy() {
    this.stop();
    this.unsubscribe?.();
  }

  setRole(role) {
    this.role = role;
    if (role === "guest") {
      this.start();
    } else {
      this.stop();
      const snapshot = this.player.getSnapshot();
      if (snapshot) {
        this.player.setPlaybackRate(snapshot.playbackRate);
      }
    }
  }

  setState(state) {
    if (!state) {
      this.state = null;
      this.player.setPlaybackRate(1);
      return;
    }

    if (this.state && state.sequence < this.state.sequence) {
      return;
    }

    this.state = state;

    if (this.role === "guest") {
      this.reconcile(true);
    }
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(
      () => this.reconcile(false),
      WatchHome.Config.guestCorrectionIntervalMs,
    );
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.stableSince = null;
  }

  reconcile(immediate) {
    if (this.role !== "guest" || !this.state) {
      return;
    }

    const snapshot = this.player.getSnapshot();
    if (!snapshot || snapshot.mediaId !== this.state.mediaId) {
      return;
    }

    const hostRate = this.state.playbackRate;
    const expected = expectedPosition(this.state, this.clock.serverNow());
    const drift = expected - snapshot.position;
    const absoluteDrift = Math.abs(drift);

    if (this.state.paused || this.state.stalled) {
      this.player.setPlaybackRate(hostRate);
      this.player.pause();

      if (absoluteDrift > 0.12) {
        this.player.seek(expected);
      }
      return;
    }

    if (absoluteDrift > 1.5) {
      this.hardRecover();
      return;
    }

    if (snapshot.paused) {
      this.hardRecover();
      return;
    }

    if (absoluteDrift < 0.07) {
      if (this.stableSince === null) {
        this.stableSince = performance.now();
      }

      if (performance.now() - this.stableSince >= 1000 || immediate) {
        this.player.setPlaybackRate(hostRate);
      }
      return;
    }

    this.stableSince = null;

    if (absoluteDrift < 0.12) {
      return;
    }

    const correction =
      absoluteDrift < 0.4 ? 0.02 : absoluteDrift < 0.9 ? 0.04 : 0.06;
    const direction = drift > 0 ? 1 : -1;
    const adjustedRate = hostRate * (1 + correction * direction);
    this.player.setPlaybackRate(adjustedRate);
  }

  async hardRecover() {
    if (!this.state) {
      return;
    }

    const projectedTarget = expectedPosition(
      this.state,
      this.clock.serverNow(),
      this.recoveryLatencyMs,
    );

    this.pendingRecoveryStartedAt = performance.now();
    this.player.setPlaybackRate(this.state.playbackRate);
    this.player.seek(projectedTarget);

    const played = await this.player.play();
    if (!played) {
      this.pendingRecoveryStartedAt = null;
    }
  }
}

globalThis.WatchHome.ClockEstimator = ClockEstimator;
globalThis.WatchHome.SyncController = SyncController;
globalThis.WatchHome.expectedPosition = expectedPosition;
