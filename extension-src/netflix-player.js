"use strict";

globalThis.WatchHome = globalThis.WatchHome ?? {};

class NetflixPlayer {
  constructor() {
    this.video = null;
    this.listeners = new Set();
    this.boundHandler = (event) => this.emit(event.type);
    this.events = [
      "play",
      "playing",
      "pause",
      "seeking",
      "seeked",
      "waiting",
      "ratechange",
      "ended",
    ];

    this.ensureTimer = setInterval(() => this.ensureVideo(), 1000);
    this.ensureVideo();
  }

  destroy() {
    clearInterval(this.ensureTimer);
    this.unbindVideo();
    this.listeners.clear();
  }

  getMediaId() {
    const match = window.location.pathname.match(/^\/watch\/(\d+)/);
    return match?.[1] ?? null;
  }

  getVideo() {
    this.ensureVideo();
    return this.video;
  }

  getSnapshot() {
    const video = this.getVideo();
    if (!video) {
      return null;
    }

    return {
      mediaId: this.getMediaId(),
      position: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      paused: video.paused,
      playbackRate: Number.isFinite(video.playbackRate)
        ? video.playbackRate
        : 1,
      readyState: video.readyState,
      ended: video.ended,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async play() {
    const video = this.getVideo();
    if (!video || !video.paused) {
      return true;
    }

    try {
      await video.play();
      return true;
    } catch {
      return false;
    }
  }

  pause() {
    const video = this.getVideo();
    if (video && !video.paused) {
      video.pause();
    }
  }

  seek(position) {
    const video = this.getVideo();
    if (!video || !Number.isFinite(position)) {
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.max(0, Math.min(position, duration));
  }

  setPlaybackRate(rate) {
    const video = this.getVideo();
    if (!video || !Number.isFinite(rate)) {
      return;
    }

    video.playbackRate = Math.max(0.25, Math.min(rate, 4));
  }

  ensureVideo() {
    const nextVideo = document.querySelector("video");
    if (nextVideo === this.video) {
      return;
    }

    this.unbindVideo();
    this.video = nextVideo;

    if (this.video) {
      for (const eventName of this.events) {
        this.video.addEventListener(eventName, this.boundHandler);
      }
      this.emit("videochange");
    }
  }

  unbindVideo() {
    if (!this.video) {
      return;
    }

    for (const eventName of this.events) {
      this.video.removeEventListener(eventName, this.boundHandler);
    }
    this.video = null;
  }

  emit(type) {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener({ type, snapshot });
    }
  }
}

globalThis.WatchHome.NetflixPlayer = NetflixPlayer;
