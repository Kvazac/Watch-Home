"use strict";

(() => {
  const { MessageType } = globalThis.WatchHomeProtocol;
  const player = new globalThis.NetflixPlayerAdapter();
  const controller = new globalThis.WatchHomeSyncController(
    player,
    (message) => sendPortMessage({
      type: MessageType.PLAYER_ERROR,
      message
    })
  );

  let port = null;
  let reconnectTimer = null;
  let session = null;
  let clockOffsetMs = 0;
  let latestRoomState = null;
  let hostStalled = false;
  let stallTimer = null;
  let heartbeatTimer = null;

  function connectPort() {
    if (port) {
      return;
    }

    port = browser.runtime.connect({ name: "watch-home-netflix" });

    port.onMessage.addListener(handleBackgroundMessage);
    port.onDisconnect.addListener(() => {
      port = null;

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectPort();
      }, 750);
    });

    announceContent();
  }

  function sendPortMessage(message) {
    try {
      port?.postMessage(message);
    } catch (error) {
      console.warn("Watch Home port message failed", error);
    }
  }

  function announceContent() {
    sendPortMessage({
      type: MessageType.CONTENT_READY,
      watchId: player.getWatchId(),
      url: window.location.href
    });
  }

  function handleBackgroundMessage(message) {
    switch (message.type) {
      case MessageType.SESSION:
        session = message.session;
        clockOffsetMs = message.clockOffsetMs ?? clockOffsetMs;

        if (session?.role === "host" && session.connected) {
          sendHostState("session-ready");
        }
        break;

      case MessageType.CLOCK:
        clockOffsetMs = message.clockOffsetMs;
        controller.updateClockOffset(clockOffsetMs);
        break;

      case MessageType.ROOM_STATE:
        latestRoomState = message.state;
        clockOffsetMs = message.clockOffsetMs ?? clockOffsetMs;

        if (session?.role === "guest") {
          controller.applyRoomState(latestRoomState, clockOffsetMs);
        }
        break;

      case MessageType.HOST_OFFLINE:
        latestRoomState = message.state ?? latestRoomState;

        if (session?.role === "guest" && latestRoomState) {
          controller.applyRoomState(latestRoomState, clockOffsetMs);
        }
        break;

      default:
        break;
    }
  }

  function sendHostState(reason, modeOverride = null) {
    if (session?.role !== "host" || !session.connected) {
      return;
    }

    const state = player.getState(modeOverride ?? (hostStalled ? "stalled" : null));
    if (!state) {
      return;
    }

    sendPortMessage({
      type: MessageType.HOST_STATE,
      reason,
      state
    });
  }

  function handleGuestLocalMutation() {
    if (
      session?.role !== "guest" ||
      controller.isSuppressingLocalEvents() ||
      !latestRoomState
    ) {
      return;
    }

    window.setTimeout(() => controller.reapplyNow(), 25);
  }

  player.on("play", () => {
    if (session?.role === "host" && !hostStalled) {
      sendHostState("play", "playing");
    } else {
      handleGuestLocalMutation();
    }
  });

  player.on("pause", () => {
    if (session?.role === "host") {
      hostStalled = false;
      sendHostState("pause", "paused");
    } else {
      handleGuestLocalMutation();
    }
  });

  player.on("seeked", () => {
    if (session?.role === "host") {
      sendHostState("seek");
    } else {
      handleGuestLocalMutation();
    }
  });

  player.on("ratechange", () => {
    if (session?.role === "host") {
      sendHostState("ratechange");
    } else {
      handleGuestLocalMutation();
    }
  });

  player.on("waiting", ({ video }) => {
    if (session?.role !== "host" || video.paused) {
      return;
    }

    if (stallTimer !== null) {
      window.clearTimeout(stallTimer);
    }

    stallTimer = window.setTimeout(() => {
      stallTimer = null;

      if (
        session?.role === "host" &&
        !video.paused &&
        video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
      ) {
        hostStalled = true;
        sendHostState("stall", "stalled");
      }
    }, 200);
  });

  player.on("playing", () => {
    if (stallTimer !== null) {
      window.clearTimeout(stallTimer);
      stallTimer = null;
    }

    if (session?.role === "host" && hostStalled) {
      hostStalled = false;
      sendHostState("stall-recovered", "playing");
    }
  });

  player.on("navigation", () => {
    announceContent();
    latestRoomState = null;

    if (session?.role === "host") {
      window.setTimeout(() => sendHostState("navigation"), 500);
    }
  });

  player.on("videochange", () => {
    if (session?.role === "host") {
      window.setTimeout(() => sendHostState("videochange"), 250);
    }
  });

  player.start();
  controller.start();
  connectPort();

  heartbeatTimer = window.setInterval(() => {
    if (session?.role === "host" && session.connected) {
      sendHostState("heartbeat");
    }
  }, 2500);

  window.addEventListener("pagehide", () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
    }

    player.stop();
    controller.stop();
    port?.disconnect();
  });
})();
