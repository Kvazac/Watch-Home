"use strict";

(() => {
  const REQUEST_EVENT = "watch-home:netflix-command";
  const RESPONSE_EVENT = "watch-home:netflix-response";

  class NetflixPlayerAdapter {
    constructor() {
      this.video = null;
      this.watchId = this.getWatchId();
      this.listeners = new Map();
      this.monitorTimer = null;
      this.boundForwarders = new Map();

      this.lastSeekAt = null;
      this.lastSeekError = null;
    }

    start() {
      if (this.monitorTimer !== null) {
        return;
      }

      this.attachCurrentVideo();

      this.monitorTimer = window.setInterval(() => {
        this.attachCurrentVideo();

        const nextWatchId = this.getWatchId();

        if (nextWatchId !== this.watchId) {
          const previousWatchId = this.watchId;
          this.watchId = nextWatchId;

          this.emit("navigation", {
            watchId: nextWatchId,
            previousWatchId
          });
        }
      }, 400);
    }

    stop() {
      if (this.monitorTimer !== null) {
        window.clearInterval(this.monitorTimer);
        this.monitorTimer = null;
      }

      this.detachVideo();
    }

    on(eventName, callback) {
      if (!this.listeners.has(eventName)) {
        this.listeners.set(eventName, new Set());
      }

      this.listeners.get(eventName).add(callback);

      return () =>
        this.listeners.get(eventName)?.delete(callback);
    }

    emit(eventName, payload) {
      for (const callback of this.listeners.get(eventName) ?? []) {
        try {
          callback(payload);
        } catch (error) {
          console.error(
            "Watch Home listener failed",
            error
          );
        }
      }
    }

    getWatchId() {
      const match =
        window.location.pathname.match(/^\/watch\/(\d+)/);

      return match?.[1] ?? null;
    }

    getVideo() {
      this.attachCurrentVideo();
      return this.video;
    }

    getState(modeOverride = null) {
      const video = this.getVideo();
      const watchId = this.getWatchId();

      if (!video || !watchId) {
        return null;
      }

      return {
        watchId,
        position: Number.isFinite(video.currentTime)
          ? video.currentTime
          : 0,
        playbackRate: Number.isFinite(video.playbackRate)
          ? video.playbackRate
          : 1,
        mode:
          modeOverride ??
          (video.paused ? "paused" : "playing")
      };
    }

    getDiagnostics() {
      const video = this.getVideo();

      return {
        watchId: this.getWatchId(),
        hasVideo: Boolean(video),
        position:
          video && Number.isFinite(video.currentTime)
            ? video.currentTime
            : null,
        duration:
          video && Number.isFinite(video.duration)
            ? video.duration
            : null,
        paused: video?.paused ?? null,
        playbackRate:
          video && Number.isFinite(video.playbackRate)
            ? video.playbackRate
            : null,
        readyState: video?.readyState ?? null,
        networkState: video?.networkState ?? null,
        seekTransport: "netflix-player-api",
        lastSeekAt: this.lastSeekAt,
        lastSeekError: this.lastSeekError
      };
    }

    async play() {
      const video = this.getVideo();

      if (!video) {
        throw new Error(
          "Netflix video element is not available."
        );
      }

      await video.play();
    }

    pause() {
      const video = this.getVideo();

      if (!video) {
        return;
      }

      video.pause();
    }

    seek(positionSeconds) {
      const video = this.getVideo();

      if (
        !video ||
        !Number.isFinite(positionSeconds)
      ) {
        return false;
      }

      const duration =
        Number.isFinite(video.duration)
          ? video.duration
          : null;

      const upperBound =
        duration === null
          ? Math.max(0, positionSeconds)
          : Math.max(0, duration - 0.05);

      const targetSeconds = Math.min(
        Math.max(0, positionSeconds),
        upperBound
      );

      const result = this.sendNetflixCommand(
        "seek",
        {
          positionMs: Math.round(
            targetSeconds * 1000
          )
        }
      );

      this.lastSeekAt = Date.now();

      if (!result?.ok) {
        this.lastSeekError =
          result?.error ??
          "Netflix player API did not accept the seek.";

        console.warn(
          "Watch Home Netflix seek failed:",
          this.lastSeekError
        );

        return false;
      }

      this.lastSeekError = null;
      return true;
    }

    setPlaybackRate(playbackRate) {
      const video = this.getVideo();

      if (
        !video ||
        !Number.isFinite(playbackRate)
      ) {
        return;
      }

      const safeRate = Math.min(
        4,
        Math.max(0.25, playbackRate)
      );

      if (
        Math.abs(
          video.playbackRate - safeRate
        ) > 0.002
      ) {
        video.playbackRate = safeRate;
      }
    }

    sendNetflixCommand(command, payload = {}) {
      const id = crypto.randomUUID();
      let response = null;

      const handleResponse = (event) => {
        if (typeof event.detail !== "string") {
          return;
        }

        try {
          const candidate =
            JSON.parse(event.detail);

          if (candidate.id === id) {
            response = candidate;
          }
        } catch {
          // Ignore malformed page responses.
        }
      };

      document.addEventListener(
        RESPONSE_EVENT,
        handleResponse
      );

      try {
        document.dispatchEvent(
          new CustomEvent(REQUEST_EVENT, {
            detail: JSON.stringify({
              id,
              command,
              payload
            })
          })
        );
      } finally {
        document.removeEventListener(
          RESPONSE_EVENT,
          handleResponse
        );
      }

      return response;
    }

    attachCurrentVideo() {
      const nextVideo =
        document.querySelector("video");

      if (nextVideo === this.video) {
        return;
      }

      this.detachVideo();
      this.video = nextVideo;

      if (!this.video) {
        return;
      }

      const eventNames = [
        "play",
        "pause",
        "playing",
        "waiting",
        "stalled",
        "seeking",
        "seeked",
        "ratechange",
        "loadedmetadata",
        "canplay",
        "emptied"
      ];

      for (const eventName of eventNames) {
        const forwarder = (event) => {
          this.emit(eventName, {
            event,
            video: this.video
          });
        };

        this.boundForwarders.set(
          eventName,
          forwarder
        );

        this.video.addEventListener(
          eventName,
          forwarder
        );
      }

      this.emit("videochange", {
        video: this.video
      });
    }

    detachVideo() {
      if (!this.video) {
        return;
      }

      for (
        const [eventName, forwarder]
        of this.boundForwarders
      ) {
        this.video.removeEventListener(
          eventName,
          forwarder
        );
      }

      this.boundForwarders.clear();
      this.video = null;
    }
  }

  globalThis.NetflixPlayerAdapter =
    NetflixPlayerAdapter;
})();
