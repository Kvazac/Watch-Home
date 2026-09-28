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
  let stateRequestedForConnection = false;
  let hostSeedTimer = null;

  function connectPort() {
    if (port) {
      return;
    }

    port = browser.runtime.connect({ name: "watch-home-netflix" });
    port.onMessage.addListener(handleBackgroundMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      stateRequestedForConnection = false;

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
          stateRequestedForConnection = false;
          clearHostSeedTimer();
          controller.stop();
          controller.start();
          return;
        }

        if (session.connected && !stateRequestedForConnection) {
          stateRequestedForConnection = true;
          sendPortMessage({ type: MessageType.REQUEST_STATE });
        }

        if (
          session.role === "host" &&
          session.connected &&
          !latestRoomState
        ) {
          scheduleInitialHostSeed();
        }
        break;

      case MessageType.CLOCK:
        clockOffsetMs = message.clockOffsetMs;
        controller.updateClockOffset(clockOffsetMs);
        break;

      case MessageType.ROOM_SETTINGS:
        if (session) {
          session.controlMode = normalizeControlMode(message.controlMode);
        }
        break;

      case MessageType.ROOM_STATE:
        latestRoomState = message.state;
        clockOffsetMs = message.clockOffsetMs ?? clockOffsetMs;
        clearHostSeedTimer();
        controller.applyRoomState(latestRoomState, clockOffsetMs);
        break;

      case MessageType.HOST_OFFLINE:
        latestRoomState = message.state ?? latestRoomState;

        if (session?.role === "guest" && latestRoomState) {
          controller.applyRoomState(latestRoomState, clockOffsetMs);
        }
        break;

      case MessageType.CONTROL_REJECTED:
        controller.cancelLocalControl();

        if (latestRoomState) {
          controller.applyRoomState(latestRoomState, clockOffsetMs);
        }
        break;

      default:
        break;
    }
  }

  function normalizeControlMode(value) {
    return value === "everyone" ? "everyone" : "host-only";
  }

  function canControlPlayback() {
    if (!session?.connected) {
      return false;
    }

    if (session.role === "host") {
      return true;
    }

    return (
      session.role === "guest" &&
      normalizeControlMode(session.controlMode) === "everyone" &&
      latestRoomState?.mode !== "offline"
    );
  }

  function sendParticipantState(reason, modeOverride = null) {
    if (
      !canControlPlayback() ||
      controller.isSuppressingLocalEvents(reason)
    ) {
      return false;
    }

    const state = player.getState(
      modeOverride ?? (hostStalled ? "stalled" : null)
    );

    if (!state) {
      return false;
    }

    controller.beginLocalControl();
    sendPortMessage({
      type: MessageType.CONTROL_STATE,
      reason,
      state
    });

    return true;
  }

  function sendHostSystemState(reason, modeOverride = null) {
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

  function handleUnauthorizedGuestMutation(reason) {
    if (
      session?.role !== "guest" ||
      controller.isSuppressingLocalEvents(reason) ||
      !latestRoomState
    ) {
      return;
    }

    window.setTimeout(() => controller.reapplyNow(), 30);
  }

  function handleManualPlaybackMutation(reason, modeOverride = null) {
    if (controller.isSuppressingLocalEvents(reason)) {
      return;
    }

    if (sendParticipantState(reason, modeOverride)) {
      return;
    }

    handleUnauthorizedGuestMutation(reason);
  }

  function scheduleInitialHostSeed() {
    if (hostSeedTimer !== null) {
      return;
    }

    hostSeedTimer = window.setTimeout(() => {
      hostSeedTimer = null;

      if (
        session?.role === "host" &&
        session.connected &&
        !latestRoomState
      ) {
        sendHostSystemState("session-ready");
      }
    }, 350);
  }

  function clearHostSeedTimer() {
    if (hostSeedTimer !== null) {
      window.clearTimeout(hostSeedTimer);
      hostSeedTimer = null;
    }
  }

  function sendDiagnostics() {
    const playerDiagnostics = player.getDiagnostics();
    const syncDiagnostics = session
      ? controller.getDiagnostics()
      : { mode: "not-in-party" };

    sendPortMessage({
      type: MessageType.DIAGNOSTICS,
      diagnostics: {
        sampledAt: Date.now(),
        player: playerDiagnostics,
        sync: syncDiagnostics,
        controlMode: normalizeControlMode(session?.controlMode),
        canControl: canControlPlayback()
      }
    });
  }

  player.on("play", () => {
    if (session?.role === "host" && hostStalled) {
      hostStalled = false;
    }

    handleManualPlaybackMutation("play", "playing");
  });

  player.on("pause", () => {
    if (session?.role === "host") {
      hostStalled = false;
    }

    handleManualPlaybackMutation("pause", "paused");
  });

  player.on("seeked", () => {
    handleManualPlaybackMutation("seek");
  });

  player.on("ratechange", () => {
    handleManualPlaybackMutation("ratechange");
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
        sendHostSystemState("stall", "stalled");
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
      sendHostSystemState("stall-recovered", "playing");
    }

    if (session) {
      sendPortMessage({
        type: MessageType.PLAYER_ERROR,
        message: null
      });

      if (!controller.isSuppressingLocalEvents("playing")) {
        controller.reapplyNow();
      }
    }
  });

  player.on("canplay", () => {
    if (session) {
      controller.reapplyNow();
    }
  });

  player.on("navigation", ({ watchId }) => {
    announceContent();
    latestRoomState = null;
    stateRequestedForConnection = false;

    if (session?.role === "host" && watchId) {
      window.setTimeout(
        () => sendHostSystemState("navigation"),
        500
      );
    } else if (session?.role === "guest") {
      window.setTimeout(
        () => sendPortMessage({ type: MessageType.REQUEST_STATE }),
        250
      );
    }
  });

  player.on("videochange", () => {
    announceContent();

    if (session?.role === "host") {
      window.setTimeout(
        () => sendHostSystemState("videochange"),
        250
      );
    } else if (session?.role === "guest") {
      window.setTimeout(() => controller.reapplyNow(), 250);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      return;
    }

    announceContent();

    if (!session) {
      return;
    }

    sendPortMessage({ type: MessageType.REQUEST_STATE });

    if (session.role === "host" && session.controlMode === "host-only") {
      window.setTimeout(
        () => sendHostSystemState("visibility-resume"),
        100
      );
    } else {
      window.setTimeout(() => controller.reapplyNow(), 100);
    }
  });

  window.addEventListener("pageshow", () => {
    announceContent();

    if (session) {
      sendPortMessage({ type: MessageType.REQUEST_STATE });
    }
  });

  player.start();
  controller.start();
  connectPort();

  heartbeatTimer = window.setInterval(() => {
    if (
      session?.role === "host" &&
      session.connected &&
      normalizeControlMode(session.controlMode) === "host-only"
    ) {
      sendHostSystemState("heartbeat");
    }
  }, config.heartbeatIntervalMs);

  diagnosticsTimer = window.setInterval(
    sendDiagnostics,
    config.diagnosticsIntervalMs
  );

  window.addEventListener("pagehide", () => {
    clearHostSeedTimer();

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
