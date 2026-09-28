"use strict";

(() => {
  const { MessageType } = globalThis.WatchHomeProtocol;
  const config = globalThis.WatchHomeConfig;
  const syncMath = globalThis.WatchHomeSyncMath;

  const NETWORK_ERROR_MESSAGE = "Could not reach the Watch Home server.";
  const RECONNECTING_MESSAGE = "Connection lost. Reconnecting…";
  const PROTOCOL_VERSION = globalThis.WatchHomeProtocol.PROTOCOL_VERSION;
  const CLIENT_VERSION = browser.runtime.getManifest().version;
  const TERMINAL_CLOSE_CODES = new Set([4003, 4008, 4406, 4409]);

  if (!syncMath) {
    throw new Error(
      "Watch Home SyncMath is not loaded. Add shared/sync-math.js before background.js in manifest.json."
    );
  }

  let socket = null;
  let socketGeneration = 0;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let reconnectAllowed = true;
  let clockTimer = null;
  let clockSamples = [];
  let clockOffsetMs = 0;
  let clockRttMs = null;
  let session = null;
  let lastRoomState = null;
  let lastSequence = null;
  let participantCount = 0;
  let controlMode = "host-only";
  let backendCompatibility = null;
  let intentionallyClosed = false;

  const contentPorts = new Map();
  const ready = restoreState();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "watch-home-netflix") {
      return;
    }

    const info = {
      tabId: port.sender?.tab?.id ?? null,
      windowId: port.sender?.tab?.windowId ?? null,
      watchId: null,
      url: null,
      diagnostics: null,
      lastSeenAt: Date.now()
    };
    contentPorts.set(port, info);

    port.onMessage.addListener((message) => {
      void ready.then(() => handleContentMessage(port, message));
    });

    port.onDisconnect.addListener(() => {
      contentPorts.delete(port);
    });

    void ready.then(async () => {
      await maybeRebindRestoredSession(info);
      sendSessionToPort(port);

      if (lastRoomState && isSessionPort(port)) {
        postToPort(port, {
          type: MessageType.ROOM_STATE,
          state: lastRoomState,
          clockOffsetMs
        });
      }

      if (session && isSessionPort(port) && !isSocketUsable()) {
        await connectWebSocket();
      }
    });
  });

  browser.runtime.onMessage.addListener((message) => {
    return ready.then(() => handleRuntimeMessage(message));
  });

  browser.runtime.onStartup.addListener(() => {
    void ready.then(() => {
      if (session && sessionPort() && !isSocketUsable()) {
        return connectWebSocket();
      }
      return null;
    });
  });

  async function restoreState() {
    const stored = await browser.storage.local.get([
      "watchHomeClientId",
      "watchHomeSession"
    ]);

    if (!stored.watchHomeClientId) {
      stored.watchHomeClientId = globalThis.WatchHomeProtocol.createClientId();
      await browser.storage.local.set({
        watchHomeClientId: stored.watchHomeClientId
      });
    }

    session = stored.watchHomeSession ?? null;
    controlMode = normalizeControlMode(session?.controlMode);

    if (!session) {
      return;
    }

    session.connected = false;
    session.status = "disconnected";

    if (
      session.lastError === NETWORK_ERROR_MESSAGE ||
      session.lastError === RECONNECTING_MESSAGE
    ) {
      session.lastError = null;
    }
  }

  async function handleRuntimeMessage(message) {
    switch (message?.type) {
      case "POPUP_GET_STATUS":
        return buildStatus();

      case "POPUP_CREATE":
        return createParty();

      case "POPUP_JOIN":
        return joinParty(message.roomId);

      case "POPUP_LEAVE":
        await leaveParty();
        return buildStatus();

      case "POPUP_RECONNECT":
        reconnectAllowed = true;
        await connectWebSocket(true);
        return buildStatus();

      case "POPUP_OPEN_CORRECT":
        await openCorrectVideo();
        return buildStatus();

      case "POPUP_SET_CONTROL_MODE":
        return setControlMode(message.controlMode);

      default:
        return null;
    }
  }

  async function handleContentMessage(port, message) {
    const info = contentPorts.get(port);
    if (!info) {
      return;
    }

    info.lastSeenAt = Date.now();

    switch (message.type) {
      case MessageType.CONTENT_READY:
        info.watchId = message.watchId ?? null;
        info.url = message.url ?? null;
        contentPorts.set(port, info);

        await maybeRebindRestoredSession(info);

        if (
          session?.role === "host" &&
          isSessionPort(port) &&
          info.watchId &&
          session.watchId !== info.watchId
        ) {
          session.watchId = info.watchId;
          await persistSession();
        }

        sendSessionToPort(port);

        if (lastRoomState && isSessionPort(port)) {
          postToPort(port, {
            type: MessageType.ROOM_STATE,
            state: lastRoomState,
            clockOffsetMs
          });
        }

        if (session && isSessionPort(port) && !isSocketUsable()) {
          await connectWebSocket();
        }
        break;

      case MessageType.HOST_STATE:
        if (
          session?.role === "host" &&
          isSessionPort(port) &&
          isSocketOpen()
        ) {
          sendSocket({
            type: MessageType.HOST_STATE,
            reason: message.reason,
            state: message.state,
            estimatedServerTime: Date.now() + clockOffsetMs
          });
        }
        break;

      case MessageType.CONTROL_STATE:
        if (
          session &&
          isSessionPort(port) &&
          isSocketOpen() &&
          (
            session.role === "host" ||
            controlMode === "everyone"
          )
        ) {
          sendSocket({
            type: MessageType.CONTROL_STATE,
            reason: message.reason,
            state: message.state,
            estimatedServerTime: Date.now() + clockOffsetMs
          });
        }
        break;

      case MessageType.REQUEST_STATE:
        if (isSessionPort(port) && isSocketOpen()) {
          sendSocket({ type: MessageType.REQUEST_STATE });
        }
        break;

      case MessageType.PLAYER_ERROR:
        if (session && isSessionPort(port)) {
          session.lastError = message.message ?? null;
          await persistSession();
        }
        break;

      case MessageType.DIAGNOSTICS:
        info.diagnostics = message.diagnostics ?? null;
        contentPorts.set(port, info);
        break;

      default:
        break;
    }
  }

  async function createParty() {
    const active = await activeContent();
    if (!active?.watchId) {
      return {
        ok: false,
        error:
          "Open and start a Netflix movie or episode in the current tab before creating a party. Reload the Netflix watch page after installing or updating Watch Home."
      };
    }

    const compatibility = await ensureBackendCompatibility(true);
    if (!compatibility.ok) {
      return compatibility;
    }

    const roomId = globalThis.WatchHomeProtocol.createRoomId();
    await startSession({
      roomId,
      role: "host",
      watchId: active.watchId,
      tabId: active.tabId
    });

    return {
      ok: true,
      ...(await buildStatus())
    };
  }

  async function joinParty(rawRoomId) {
    const roomId = globalThis.WatchHomeProtocol.normalizeRoomId(rawRoomId);
    if (!globalThis.WatchHomeProtocol.isValidRoomId(roomId)) {
      return {
        ok: false,
        error: "Enter the complete 12-character room code."
      };
    }

    const active = await activeContent();
    if (!active?.watchId) {
      return {
        ok: false,
        error:
          "Open the Netflix watch page from the host invite first, then reload it after installing or updating Watch Home."
      };
    }

    const compatibility = await ensureBackendCompatibility(true);
    if (!compatibility.ok) {
      return compatibility;
    }

    await startSession({
      roomId,
      role: "guest",
      watchId: active.watchId,
      tabId: active.tabId
    });

    return {
      ok: true,
      ...(await buildStatus())
    };
  }

  async function startSession(nextSession) {
    intentionallyClosed = true;
    reconnectAllowed = false;
    clearReconnectTimer();
    closeSocket();

    session = {
      ...nextSession,
      connected: false,
      status: "connecting",
      lastError: null
    };

    lastRoomState = null;
    lastSequence = null;
    participantCount = 0;
    controlMode = "host-only";
    reconnectAttempt = 0;
    clockSamples = [];
    clockOffsetMs = 0;
    clockRttMs = null;

    await persistSession();

    intentionallyClosed = false;
    reconnectAllowed = true;
    await connectWebSocket(true);
    broadcastSession();
  }

  async function leaveParty() {
    intentionallyClosed = true;
    reconnectAllowed = false;
    clearReconnectTimer();

    if (isSocketOpen()) {
      sendSocket({ type: MessageType.LEAVE });
    }

    closeSocket();

    session = null;
    lastRoomState = null;
    lastSequence = null;
    participantCount = 0;
    controlMode = "host-only";
    reconnectAttempt = 0;
    clockSamples = [];
    clockOffsetMs = 0;
    clockRttMs = null;

    await browser.storage.local.remove("watchHomeSession");
    broadcastSession();
    intentionallyClosed = false;
  }

  async function connectWebSocket(force = false) {
    if (!session || !sessionPort()) {
      return;
    }

    if (config.backendWsOrigin.includes("example.workers.dev")) {
      session.status = "configuration-error";
      session.lastError =
        "The production Cloudflare Worker URL has not been configured.";
      await persistSession();
      broadcastSession();
      return;
    }

    if (!force && isSocketUsable()) {
      return;
    }

    const compatibility = await ensureBackendCompatibility();
    if (!compatibility.ok) {
      await setCompatibilityFailure(compatibility.error);
      return;
    }

    clearReconnectTimer();
    closeSocket();

    const stored = await browser.storage.local.get("watchHomeClientId");
    const generation = ++socketGeneration;
    const query = new URLSearchParams({
      role: session.role,
      clientId: stored.watchHomeClientId,
      protocolVersion: String(PROTOCOL_VERSION),
      clientVersion: CLIENT_VERSION
    });

    session.connected = false;
    session.status = "connecting";
    clearNetworkError();
    await persistSession();
    broadcastSession();

    const ws = new WebSocket(
      `${config.backendWsOrigin}/ws/${session.roomId}?${query.toString()}`
    );
    socket = ws;

    ws.addEventListener("open", () => {
      if (!isCurrentSocket(ws, generation)) {
        safelyClose(ws, 1000, "Superseded connection");
        return;
      }

      reconnectAttempt = 0;
      reconnectAllowed = true;
      startClockSync();
      sendPing();
    });

    ws.addEventListener("message", (event) => {
      if (isCurrentSocket(ws, generation)) {
        handleSocketMessage(event.data);
      }
    });

    ws.addEventListener("error", () => {
      if (!isCurrentSocket(ws, generation)) {
        return;
      }

      // The close event owns connection state because WebSocket error gives no reason.
      console.warn("Watch Home WebSocket reported a transport error.");
    });

    ws.addEventListener("close", (event) => {
      if (!isCurrentSocket(ws, generation)) {
        return;
      }

      stopClockSync();
      socket = null;

      if (TERMINAL_CLOSE_CODES.has(event.code)) {
        reconnectAllowed = false;
      }

      if (session) {
        session.connected = false;

        const compatibilityClose =
          event.code === 4406 ||
          event.code === 4409 ||
          session.status === "compatibility-error";

        if (compatibilityClose) {
          session.status = "compatibility-error";
          session.lastError ??=
            "Watch Home client/server versions are incompatible. Update both clients and verify the server deployment.";
        } else if (session.status !== "error") {
          session.status = "disconnected";
        }

        if (
          !intentionallyClosed &&
          reconnectAllowed &&
          session.status !== "error" &&
          session.status !== "compatibility-error"
        ) {
          session.lastError = RECONNECTING_MESSAGE;
        }

        void persistSession();
        broadcastSession();
      }

      if (
        !intentionallyClosed &&
        reconnectAllowed &&
        session &&
        sessionPort()
      ) {
        scheduleReconnect();
      }
    });
  }

  function handleSocketMessage(rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    switch (message.type) {
      case MessageType.WELCOME:
        if (!session) {
          return;
        }

        if (
          Number(message.protocolVersion) !== PROTOCOL_VERSION ||
          message.roomClientVersion !== CLIENT_VERSION
        ) {
          void setCompatibilityFailure(
            Number(message.protocolVersion) !== PROTOCOL_VERSION
              ? `Server protocol ${message.protocolVersion ?? "unknown"} is incompatible with client protocol ${PROTOCOL_VERSION}.`
              : `This party requires Watch Home ${message.roomClientVersion ?? "unknown"}, but this client is ${CLIENT_VERSION}.`
          );
          safelyClose(
            socket,
            Number(message.protocolVersion) !== PROTOCOL_VERSION ? 4406 : 4409,
            "Compatibility mismatch"
          );
          return;
        }

        session.connected = true;
        session.status = "connected";
        session.role = message.role;
        session.lastError = null;
        controlMode = normalizeControlMode(message.controlMode);
        session.controlMode = controlMode;
        participantCount = message.participantCount ?? participantCount;

        if (message.state) {
          acceptRoomState(message.state, true);
        } else {
          lastRoomState = null;
          lastSequence = null;
        }

        void persistSession();
        broadcastSession();

        if (lastRoomState) {
          sendToSessionContent({
            type: MessageType.ROOM_STATE,
            state: lastRoomState,
            clockOffsetMs
          });
        }
        break;

      case MessageType.PONG:
        addClockSample(
          message.clientSentAt,
          Date.now(),
          message.serverTime
        );
        clearRecoveredNetworkError();
        break;

      case MessageType.ROOM_STATE:
        if (acceptRoomState(message.state)) {
          sendToSessionContent({
            type: MessageType.ROOM_STATE,
            state: lastRoomState,
            clockOffsetMs
          });
        }
        break;

      case MessageType.HOST_OFFLINE:
        if (acceptRoomState(message.state)) {
          sendToSessionContent({
            type: MessageType.HOST_OFFLINE,
            state: lastRoomState,
            clockOffsetMs
          });
        }
        break;

      case MessageType.PRESENCE:
        participantCount = message.participantCount ?? participantCount;
        break;

      case MessageType.ROOM_SETTINGS:
        controlMode = normalizeControlMode(message.controlMode);

        if (session) {
          session.controlMode = controlMode;
          void persistSession();
        }

        broadcastSession();
        sendToSessionContent({
          type: MessageType.ROOM_SETTINGS,
          controlMode
        });
        break;

      case MessageType.CONTROL_REJECTED:
        sendToSessionContent({
          type: MessageType.CONTROL_REJECTED,
          reason: message.reason ?? "Playback control was rejected."
        });

        if (lastRoomState) {
          sendToSessionContent({
            type: MessageType.ROOM_STATE,
            state: lastRoomState,
            clockOffsetMs
          });
        }
        break;

      case MessageType.ERROR:
        if (!session) {
          return;
        }

        session.lastError =
          message.message ?? "Server rejected the request.";
        session.status = "error";

        if (
          message.retryable === false ||
          message.code === "PROTOCOL_MISMATCH" ||
          message.code === "CLIENT_VERSION_MISMATCH" ||
          message.code === "ROOM_CLIENT_VERSION_MISMATCH"
        ) {
          reconnectAllowed = false;
        }

        if (
          message.code === "PROTOCOL_MISMATCH" ||
          message.code === "CLIENT_VERSION_MISMATCH" ||
          message.code === "ROOM_CLIENT_VERSION_MISMATCH"
        ) {
          session.status = "compatibility-error";
        }

        void persistSession();
        broadcastSession();
        break;

      default:
        break;
    }
  }

  function acceptRoomState(state, force = false) {
    if (!state) {
      return false;
    }

    if (
      !force &&
      !syncMath.isNewerSequence(lastSequence, state.sequence)
    ) {
      return false;
    }

    lastRoomState = state;

    if (Number.isFinite(state.sequence)) {
      lastSequence = state.sequence;
    }

    return true;
  }

  function addClockSample(clientSentAt, clientReceivedAt, serverTime) {
    if (
      !Number.isFinite(clientSentAt) ||
      !Number.isFinite(clientReceivedAt) ||
      !Number.isFinite(serverTime)
    ) {
      return;
    }

    const rtt = Math.max(0, clientReceivedAt - clientSentAt);
    const midpoint = (clientSentAt + clientReceivedAt) / 2;
    const offset = serverTime - midpoint;

    clockSamples.push({ rtt, offset });
    clockSamples = clockSamples.slice(-9);

    const estimate = syncMath.selectClockEstimate(clockSamples);
    clockOffsetMs = estimate.offsetMs;
    clockRttMs = estimate.rttMs;

    sendToSessionContent({
      type: MessageType.CLOCK,
      clockOffsetMs
    });
  }

  function clearNetworkError() {
    if (
      session &&
      (
        session.lastError === NETWORK_ERROR_MESSAGE ||
        session.lastError === RECONNECTING_MESSAGE
      )
    ) {
      session.lastError = null;
    }
  }

  function clearRecoveredNetworkError() {
    if (!session?.connected) {
      return;
    }

    if (
      session.lastError !== NETWORK_ERROR_MESSAGE &&
      session.lastError !== RECONNECTING_MESSAGE
    ) {
      return;
    }

    session.lastError = null;
    void persistSession();
    broadcastSession();
  }

  function startClockSync() {
    stopClockSync();
    clockTimer = setInterval(sendPing, config.clockSyncIntervalMs);
  }

  function stopClockSync() {
    if (clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function sendPing() {
    if (isSocketOpen()) {
      sendSocket({
        type: MessageType.PING,
        clientSentAt: Date.now()
      });
    }
  }

  function sendSocket(payload) {
    if (!isSocketOpen()) {
      return;
    }

    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.warn("Watch Home WebSocket send failed", error);
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();

    const exponent = Math.min(reconnectAttempt, 6);
    const baseDelay = Math.min(
      config.reconnectMaxMs,
      config.reconnectBaseMs * 2 ** exponent
    );
    const delay = baseDelay + Math.floor(Math.random() * 250);

    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectWebSocket(true);
    }, delay);
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeSocket() {
    stopClockSync();

    if (!socket) {
      return;
    }

    const closingSocket = socket;
    socketGeneration += 1;
    socket = null;
    safelyClose(closingSocket, 1000, "Client reconnecting");
  }

  function safelyClose(ws, code, reason) {
    try {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(code, reason);
      }
    } catch {
      // The socket can transition state between the check and close().
    }
  }

  function isCurrentSocket(ws, generation) {
    return generation === socketGeneration && socket === ws;
  }

  function isSocketOpen() {
    return socket?.readyState === WebSocket.OPEN;
  }

  function isSocketUsable() {
    return Boolean(
      socket &&
      (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      )
    );
  }

  async function activeContent() {
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!activeTab) {
      return null;
    }

    for (const info of contentPorts.values()) {
      if (info.tabId === activeTab.id) {
        return info;
      }
    }

    return null;
  }

  function sessionPort() {
    if (!session?.tabId) {
      return null;
    }

    for (const [port, info] of contentPorts) {
      if (info.tabId === session.tabId) {
        return port;
      }
    }

    return null;
  }

  function isSessionPort(port) {
    return Boolean(session && sessionPort() === port);
  }

  async function maybeRebindRestoredSession(info) {
    if (!session || !info?.tabId || !info.watchId || sessionPort()) {
      return;
    }

    if (
      session.tabId === info.tabId ||
      session.watchId === info.watchId
    ) {
      session.tabId = info.tabId;
      await persistSession();
    }
  }

  async function buildStatus() {
    const active = await activeContent();
    const boundPort = sessionPort();
    const bound = boundPort ? contentPorts.get(boundPort) : null;

    const mismatch = Boolean(
      session?.role === "guest" &&
      lastRoomState?.watchId &&
      bound?.watchId &&
      lastRoomState.watchId !== bound.watchId
    );

    return {
      ok: true,
      session: publicSession(),
      roomIdFormatted: session
        ? globalThis.WatchHomeProtocol.formatRoomId(session.roomId)
        : null,
      participantCount,
      controlMode,
      compatibility: backendCompatibility,
      activeWatchId: active?.watchId ?? null,
      boundWatchId: bound?.watchId ?? null,
      partyWatchId: lastRoomState?.watchId ?? null,
      hostOnline: lastRoomState
        ? lastRoomState.mode !== "offline"
        : null,
      mismatch,
      invite: session?.roomId
        ? buildInvite(
            session.roomId,
            lastRoomState?.watchId ?? bound?.watchId ?? session.watchId
          )
        : null,
      diagnostics: {
        sampledAt: Date.now(),
        network: {
          clockOffsetMs: Math.round(clockOffsetMs),
          rttMs: Number.isFinite(clockRttMs)
            ? Math.round(clockRttMs)
            : null,
          reconnectAttempt,
          sequence: lastSequence,
          socketState: socket?.readyState ?? null,
          clientVersion: CLIENT_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          serverProtocol: backendCompatibility?.serverProtocol ?? null,
          serverRelease: backendCompatibility?.serverRelease ?? null
        },
        content: bound?.diagnostics ?? null,
        room: lastRoomState
          ? {
              mode: lastRoomState.mode,
              watchId: lastRoomState.watchId,
              sequence: lastRoomState.sequence,
              playbackRate: lastRoomState.playbackRate,
              controlMode
            }
          : null
      }
    };
  }

  async function setControlMode(value) {
    if (!session) {
      return {
        ok: false,
        error: "You are not currently in a party."
      };
    }

    if (session.role !== "host") {
      return {
        ok: false,
        error: "Only the host can change playback permissions."
      };
    }

    if (!isSocketOpen()) {
      return {
        ok: false,
        error: "Reconnect before changing playback permissions."
      };
    }

    sendSocket({
      type: MessageType.SET_CONTROL_MODE,
      controlMode: normalizeControlMode(value)
    });

    return {
      ok: true,
      ...(await buildStatus())
    };
  }

  function normalizeControlMode(value) {
    return value === "everyone" ? "everyone" : "host-only";
  }

  async function ensureBackendCompatibility(force = false) {
    const now = Date.now();

    if (
      !force &&
      backendCompatibility?.checkedAt &&
      now - backendCompatibility.checkedAt < 15000
    ) {
      return backendCompatibility;
    }

    try {
      const response = await fetch(
        `${config.backendHttpOrigin}/health`,
        {
          method: "GET",
          cache: "no-store"
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const health = await response.json();
      const serverProtocol = Number(health.protocol);
      const supportedClientVersions = Array.isArray(
        health.supportedClientVersions
      )
        ? health.supportedClientVersions.map(String)
        : [];

      if (serverProtocol !== PROTOCOL_VERSION) {
        backendCompatibility = {
          ok: false,
          checkedAt: now,
          code: "PROTOCOL_MISMATCH",
          clientVersion: CLIENT_VERSION,
          clientProtocol: PROTOCOL_VERSION,
          serverProtocol,
          serverRelease: health.release ?? null,
          error:
            `Watch Home ${CLIENT_VERSION} requires protocol ${PROTOCOL_VERSION}, ` +
            `but the server reports protocol ${health.protocol ?? "unknown"}.`
        };
        return backendCompatibility;
      }

      if (
        !Array.isArray(health.supportedClientVersions) ||
        !supportedClientVersions.includes(CLIENT_VERSION)
      ) {
        backendCompatibility = {
          ok: false,
          checkedAt: now,
          code: "CLIENT_VERSION_MISMATCH",
          clientVersion: CLIENT_VERSION,
          clientProtocol: PROTOCOL_VERSION,
          serverProtocol,
          serverRelease: health.release ?? null,
          supportedClientVersions,
          error:
            `Watch Home ${CLIENT_VERSION} is not supported by server ` +
            `${health.release ?? "unknown"}. Update the extension or server.`
        };
        return backendCompatibility;
      }

      backendCompatibility = {
        ok: true,
        checkedAt: now,
        clientVersion: CLIENT_VERSION,
        clientProtocol: PROTOCOL_VERSION,
        serverProtocol,
        serverRelease: health.release ?? null,
        supportedClientVersions
      };

      return backendCompatibility;
    } catch (error) {
      backendCompatibility = {
        ok: false,
        checkedAt: now,
        code: "COMPATIBILITY_CHECK_FAILED",
        clientVersion: CLIENT_VERSION,
        clientProtocol: PROTOCOL_VERSION,
        error:
          "Could not verify Watch Home server compatibility. " +
          "Party creation/joining was blocked to avoid an unsafe mixed-version session."
      };

      console.warn("Watch Home compatibility check failed", error);
      return backendCompatibility;
    }
  }

  async function setCompatibilityFailure(message) {
    reconnectAllowed = false;

    if (!session) {
      return;
    }

    session.connected = false;
    session.status = "compatibility-error";
    session.lastError = message;
    await persistSession();
    broadcastSession();
  }

  function buildInvite(roomId, watchId) {
    const roomCode = globalThis.WatchHomeProtocol.formatRoomId(roomId);
    const netflixUrl = watchId
      ? `https://www.netflix.com/watch/${watchId}`
      : "https://www.netflix.com/";

    return `Watch Home\n\nNetflix:\n${netflixUrl}\n\nRoom:\n${roomCode}`;
  }

  function publicSession() {
    if (!session) {
      return null;
    }

    return {
      roomId: session.roomId,
      role: session.role,
      connected: Boolean(session.connected),
      status: session.status,
      controlMode,
      clientVersion: CLIENT_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      lastError: session.lastError ?? null
    };
  }

  function broadcastSession() {
    for (const [port, info] of contentPorts) {
      postToPort(port, {
        type: MessageType.SESSION,
        session:
          session && info.tabId === session.tabId
            ? publicSession()
            : null,
        clockOffsetMs
      });
    }
  }

  function sendSessionToPort(port) {
    const info = contentPorts.get(port);

    postToPort(port, {
      type: MessageType.SESSION,
      session:
        session && info?.tabId === session.tabId
          ? publicSession()
          : null,
      clockOffsetMs
    });
  }

  function sendToSessionContent(message) {
    const port = sessionPort();
    if (port) {
      postToPort(port, message);
    }
  }

  function postToPort(port, message) {
    try {
      port.postMessage(message);
    } catch {
      contentPorts.delete(port);
    }
  }

  async function openCorrectVideo() {
    if (!lastRoomState?.watchId) {
      return;
    }

    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });
    const url = `https://www.netflix.com/watch/${lastRoomState.watchId}`;

    if (activeTab?.id) {
      await browser.tabs.update(activeTab.id, { url });
      return;
    }

    await browser.tabs.create({ url });
  }

  async function persistSession() {
    if (!session) {
      await browser.storage.local.remove("watchHomeSession");
      return;
    }

    await browser.storage.local.set({
      watchHomeSession: session
    });
  }
})();
