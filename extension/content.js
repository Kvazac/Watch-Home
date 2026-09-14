"use strict";

(() => {
  const { MessageType } = globalThis.WatchHomeProtocol;
  const config = globalThis.WatchHomeConfig;
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
  let diagnosticsTimer = null;
  let guestStateRequestedForConnection = false;

  function connectPort() {
    if (port) {
      return;
    }

    port = browser.runtime.connect({ name: "watch-home-netflix" });

    port.onMessage.addListener(handleBackgroundMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      guestStateRequestedForConnection = false;

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
        controller.updateClockOffset(clockOffsetMs);

        if (!session) {
          latestRoomState = null;
          guestStateRequestedForConnection = false;
          controller.stop();
          controller.start();
          return;
        }

        if (session.role === "host" && session.connected) {
          sendHostState("session-ready");
        }

        if (
          session.role === "guest" &&
          session.connected &&
          !guestStateRequestedForConnection
        ) {
          guestStateRequestedForConnection = true;
          sendPortMessage({ type: MessageType.REQUEST_STATE });
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

    const state = player.getState(
      modeOverride ?? (hostStalled ? "stalled" : null)
    );

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

    window.setTimeout(() => controller.reapplyNow(), 30);
  }

  function sendDiagnostics() {
    const playerDiagnostics = player.getDiagnostics();
    let syncDiagnostics;

    if (session?.role === "guest") {
      syncDiagnostics = controller.getDiagnostics();
    } else if (session?.role === "host") {
      syncDiagnostics = {
        mode: hostStalled ? "host-buffering" : "host-authority",
        localPosition: playerDiagnostics.position,
        predictedPosition: playerDiagnostics.position,
        driftMs: 0,
        localRate: playerDiagnostics.playbackRate,
        canonicalRate: playerDiagnostics.playbackRate,
        readyState: playerDiagnostics.readyState,
        paused: playerDiagnostics.paused,
        playLatencyMs: null,
        seekLatencyMs: null,
        hardCorrectionCount: 0,
        softCorrectionCount: 0,
        lastCorrectionAt: null,
        sequence: latestRoomState?.sequence ?? null
      };
    } else {
      syncDiagnostics = {
        mode: "not-in-party"
      };
    }

    sendPortMessage({
      type: MessageType.DIAGNOSTICS,
      diagnostics: {
        sampledAt: Date.now(),
        player: playerDiagnostics,
        sync: syncDiagnostics
      }
    });
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

  function scheduleHostStall(video) {
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
    }, config.hostStallDebounceMs);
  }

  player.on("waiting", ({ video }) => scheduleHostStall(video));
  player.on("stalled", ({ video }) => scheduleHostStall(video));

  player.on("playing", () => {
    if (stallTimer !== null) {
      window.clearTimeout(stallTimer);
      stallTimer = null;
    }

    if (session?.role === "host" && hostStalled) {
      hostStalled = false;
      sendHostState("stall-recovered", "playing");
    }

    if (session?.role === "guest") {
      sendPortMessage({
        type: MessageType.PLAYER_ERROR,
        message: null
      });
      controller.reapplyNow();
    }
  });

  player.on("canplay", () => {
    if (session?.role === "guest") {
      controller.reapplyNow();
    }
  });

  player.on("navigation", ({ watchId }) => {
    announceContent();
    latestRoomState = null;

    if (session?.role === "host" && watchId) {
      window.setTimeout(() => sendHostState("navigation"), 500);
    }
  });

  player.on("videochange", () => {
    announceContent();

    if (session?.role === "host") {
      window.setTimeout(() => sendHostState("videochange"), 250);
    } else if (session?.role === "guest") {
      window.setTimeout(() => controller.reapplyNow(), 250);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      announceContent();

      if (session?.role === "guest") {
        sendPortMessage({ type: MessageType.REQUEST_STATE });
        controller.reapplyNow();
      } else if (session?.role === "host") {
        sendHostState("visibility-resume");
      }
    }
  });

  window.addEventListener("pageshow", () => {
    announceContent();

    if (session?.role === "guest") {
      sendPortMessage({ type: MessageType.REQUEST_STATE });
    }
  });

  player.start();
  controller.start();
  connectPort();

  heartbeatTimer = window.setInterval(() => {
    if (session?.role === "host" && session.connected) {
      sendHostState("heartbeat");
    }
  }, config.heartbeatIntervalMs);

  diagnosticsTimer = window.setInterval(
    sendDiagnostics,
    config.diagnosticsIntervalMs
  );

  window.addEventListener("pagehide", () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
    }

    if (diagnosticsTimer !== null) {
      window.clearInterval(diagnosticsTimer);
    }

    if (stallTimer !== null) {
      window.clearTimeout(stallTimer);
    }

    player.stop();
    controller.stop();
    port?.disconnect();
  });
})();
