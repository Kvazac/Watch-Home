"use strict";

(() => {
  const { MessageType } = globalThis.WatchHomeProtocol;
  const config = globalThis.WatchHomeConfig;
  const syncMath = globalThis.WatchHomeSyncMath;

  let socket = null;
  let socketGeneration = 0;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let reconnectAllowed = true;
  let clockTimer = null;
  let clockSamples = [];
  let clockOffsetMs = 0;
  let clockRttMs = null;
  const contentPorts = new Map();
  let session = null;
  let lastRoomState = null;
  let lastSequence = null;
  let participantCount = 0;
  let intentionallyClosed = false;

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

    if (session) {
      session.connected = false;
      session.status = "disconnected";
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
          session?.role !== "host" ||
          !isSessionPort(port) ||
          !isSocketOpen()
        ) {
          return;
        }

        sendSocket({
          type: MessageType.HOST_STATE,
          reason: message.reason,
          state: message.state,
          estimatedServerTime: Date.now() + clockOffsetMs
        });
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
          "Open and start a Netflix movie or episode in the current tab before creating a party."
      };
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
        error: "Open the Netflix watch page from the host invite first."
      };
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

    if (isSocketOpen()) {
      sendSocket({ type: MessageType.LEAVE });
    }

    closeSocket();
    session = null;
    lastRoomState = null;
    lastSequence = null;
    participantCount = 0;
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

    clearReconnectTimer();
    closeSocket();

    const stored = await browser.storage.local.get("watchHomeClientId");
    const clientId = stored.watchHomeClientId;
    const generation = ++socketGeneration;
    const query = new URLSearchParams({
      role: session.role,
      clientId
    });

    session.connected = false;
    session.status = "connecting";
    await persistSession();
    broadcastSession();

    const ws = new WebSocket(
      `${config.backendWsOrigin}/ws/${session.roomId}?${query.toString()}`
    );

    socket = ws;

    ws.addEventListener("open", () => {
      if (generation !== socketGeneration) {
        ws.close();
        return;
      }

      reconnectAttempt = 0;
      reconnectAllowed = true;
      startClockSync();
      sendPing();
    });

    ws.addEventListener("message", (event) => {
      if (generation !== socketGeneration) {
        return;
      }

      handleSocketMessage(event.data);
    });

    ws.addEventListener("close", (event) => {
      if (generation !== socketGeneration) {
        return;
      }

      stopClockSync();
      socket = null;

      if ([4003, 4008].includes(event.code)) {
        reconnectAllowed = false;
      }

      if (session) {
        session.connected = false;

        if (session.status !== "error") {
          session.status = "disconnected";
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

    ws.addEventListener("error", () => {
      if (session) {
        session.lastError = "Could not reach the Watch Home server.";
        void persistSession();
        broadcastSession();
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
        session.connected = true;
        session.status = "connected";
        session.role = message.role;
        session.lastError = null;
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
        break;

      case MessageType.ROOM_STATE:
        if (!acceptRoomState(message.state)) {
          return;
        }

        sendToSessionContent({
          type: MessageType.ROOM_STATE,
          state: lastRoomState,
          clockOffsetMs
        });
        break;

      case MessageType.HOST_OFFLINE:
        if (!acceptRoomState(message.state)) {
          return;
        }

        sendToSessionContent({
          type: MessageType.HOST_OFFLINE,
          state: lastRoomState
        });
        break;

      case MessageType.PRESENCE:
        participantCount = message.participantCount ?? participantCount;
        break;

      case MessageType.ERROR:
        if (session) {
          session.lastError = message.message ?? "Server rejected the request.";
          session.status = "error";

          if (message.retryable === false) {
            reconnectAllowed = false;
          }

          void persistSession();
          broadcastSession();
        }
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
    if (!isSocketOpen()) {
      return;
    }

    sendSocket({
      type: MessageType.PING,
      clientSentAt: Date.now()
    });
  }

  function sendSocket(payload) {
    if (!isSocketOpen()) {
      return;
    }

    socket.send(JSON.stringify(payload));
  }

  function scheduleReconnect() {
    clearReconnectTimer();

    const exponent = Math.min(reconnectAttempt, 6);
    const baseDelay = Math.min(
      config.reconnectMaxMs,
      config.reconnectBaseMs * 2 ** exponent
    );
    const jitter = Math.floor(Math.random() * 250);
    const delay = baseDelay + jitter;
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

    if (socket) {
      socketGeneration += 1;

      try {
        socket.close(1000, "Client reconnecting");
      } catch {
        // The socket may already be closing.
      }

      socket = null;
    }
  }

  function isSocketOpen() {
    return socket?.readyState === WebSocket.OPEN;
  }

  function isSocketUsable() {
    return (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
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
    if (!session || !info?.tabId || !info.watchId) {
      return;
    }

    if (sessionPort()) {
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
    const bound = sessionPort()
      ? contentPorts.get(sessionPort())
      : null;
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
      activeWatchId: active?.watchId ?? null,
      boundWatchId: bound?.watchId ?? null,
      partyWatchId: lastRoomState?.watchId ?? null,
      hostOnline: lastRoomState?.mode !== "offline",
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
          sequence: lastSequence
        },
        content: bound?.diagnostics ?? null,
        room: lastRoomState
          ? {
              mode: lastRoomState.mode,
              watchId: lastRoomState.watchId,
              sequence: lastRoomState.sequence,
              playbackRate: lastRoomState.playbackRate
            }
          : null
      }
    };
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
