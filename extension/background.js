"use strict";

(() => {
  const { MessageType } = globalThis.WatchHomeProtocol;
  const config = globalThis.WatchHomeConfig;

  let socket = null;
  let socketGeneration = 0;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let clockTimer = null;
  let clockSamples = [];
  let clockOffsetMs = 0;
  let contentPorts = new Map();
  let session = null;
  let lastRoomState = null;
  let participantCount = 0;
  let intentionallyClosed = false;

  const ready = restoreState();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "watch-home-netflix") {
      return;
    }

    const info = {
      watchId: null,
      url: null
    };

    contentPorts.set(port, info);

    port.onMessage.addListener((message) => {
      void ready.then(() => handleContentMessage(port, message));
    });

    port.onDisconnect.addListener(() => {
      contentPorts.delete(port);
    });

    void ready.then(async () => {
      postToPort(port, {
        type: MessageType.SESSION,
        session: publicSession(),
        clockOffsetMs
      });

      if (lastRoomState) {
        postToPort(port, {
          type: MessageType.ROOM_STATE,
          state: lastRoomState,
          clockOffsetMs
        });
      }

      if (session && !isSocketUsable()) {
        await connectWebSocket();
      }
    });
  });

  browser.runtime.onMessage.addListener((message) => {
    return ready.then(() => handleRuntimeMessage(message));
  });

  browser.runtime.onStartup.addListener(() => {
    void ready.then(() => {
      if (session && contentPorts.size > 0) {
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
        await connectWebSocket(true);
        return buildStatus();

      case "POPUP_OPEN_CORRECT":
        if (lastRoomState?.watchId) {
          await browser.tabs.create({
            url: `https://www.netflix.com/watch/${lastRoomState.watchId}`
          });
        }
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

    switch (message.type) {
      case MessageType.CONTENT_READY:
        info.watchId = message.watchId ?? null;
        info.url = message.url ?? null;
        contentPorts.set(port, info);

        postToPort(port, {
          type: MessageType.SESSION,
          session: publicSession(),
          clockOffsetMs
        });

        if (lastRoomState) {
          postToPort(port, {
            type: MessageType.ROOM_STATE,
            state: lastRoomState,
            clockOffsetMs
          });
        }
        break;

      case MessageType.HOST_STATE:
        if (session?.role !== "host" || !isSocketOpen()) {
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
        if (isSocketOpen()) {
          sendSocket({ type: MessageType.REQUEST_STATE });
        }
        break;

      case MessageType.PLAYER_ERROR:
        if (session) {
          session.lastError = message.message;
          await persistSession();
        }
        break;

      default:
        break;
    }
  }

  async function createParty() {
    const active = activeContent();
    if (!active?.watchId) {
      return {
        ok: false,
        error: "Open a Netflix movie or episode before creating a party."
      };
    }

    const roomId = globalThis.WatchHomeProtocol.createRoomId();
    await startSession({
      roomId,
      role: "host",
      watchId: active.watchId
    });

    return {
      ok: true,
      ...buildStatus()
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

    if (!activeContent()?.watchId) {
      return {
        ok: false,
        error: "Open the Netflix watch page from the host invite first."
      };
    }

    await startSession({
      roomId,
      role: "guest",
      watchId: activeContent()?.watchId ?? null
    });

    return {
      ok: true,
      ...buildStatus()
    };
  }

  async function startSession(nextSession) {
    intentionallyClosed = true;
    closeSocket();

    session = {
      ...nextSession,
      connected: false,
      status: "connecting",
      lastError: null
    };
    lastRoomState = null;
    participantCount = 0;
    reconnectAttempt = 0;

    await persistSession();
    intentionallyClosed = false;
    await connectWebSocket(true);
    broadcastSession();
  }

  async function leaveParty() {
    intentionallyClosed = true;

    if (isSocketOpen()) {
      sendSocket({ type: MessageType.LEAVE });
    }

    closeSocket();
    session = null;
    lastRoomState = null;
    participantCount = 0;
    reconnectAttempt = 0;
    clockSamples = [];
    clockOffsetMs = 0;

    await browser.storage.local.remove("watchHomeSession");
    broadcastSession();

    intentionallyClosed = false;
  }

  async function connectWebSocket(force = false) {
    if (!session) {
      return;
    }

    if (
      config.backendWsOrigin.includes("example.workers.dev")
    ) {
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
      startClockSync();
      sendPing();
    });

    ws.addEventListener("message", (event) => {
      if (generation !== socketGeneration) {
        return;
      }

      handleSocketMessage(event.data);
    });

    ws.addEventListener("close", () => {
      if (generation !== socketGeneration) {
        return;
      }

      stopClockSync();
      socket = null;

      if (session) {
        session.connected = false;
        session.status = "disconnected";
        void persistSession();
        broadcastSession();
      }

      if (!intentionallyClosed && session) {
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
        lastRoomState = message.state ?? lastRoomState;
        void persistSession();

        if (Number.isFinite(message.serverTime)) {
          addClockSample(Date.now(), Date.now(), message.serverTime);
        }

        broadcastSession();

        if (lastRoomState) {
          broadcastToContent({
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
        lastRoomState = message.state;
        broadcastToContent({
          type: MessageType.ROOM_STATE,
          state: lastRoomState,
          clockOffsetMs
        });
        break;

      case MessageType.HOST_OFFLINE:
        lastRoomState = message.state ?? lastRoomState;
        broadcastToContent({
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
          void persistSession();
          broadcastSession();
        }
        break;

      default:
        break;
    }
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

    const preferred = [...clockSamples]
      .sort((left, right) => left.rtt - right.rtt)
      .slice(0, Math.min(3, clockSamples.length));

    clockOffsetMs =
      preferred.reduce((sum, sample) => sum + sample.offset, 0) /
      preferred.length;

    broadcastToContent({
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

    const delay = Math.min(
      config.reconnectMaxMs,
      config.reconnectBaseMs * 2 ** reconnectAttempt
    );
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

  function activeContent() {
    for (const info of contentPorts.values()) {
      if (info.watchId) {
        return info;
      }
    }

    return null;
  }

  function buildStatus() {
    const active = activeContent();
    const mismatch = Boolean(
      session?.role === "guest" &&
      lastRoomState?.watchId &&
      active?.watchId &&
      lastRoomState.watchId !== active.watchId
    );

    return {
      ok: true,
      session: publicSession(),
      roomIdFormatted: session
        ? globalThis.WatchHomeProtocol.formatRoomId(session.roomId)
        : null,
      participantCount,
      activeWatchId: active?.watchId ?? null,
      partyWatchId: lastRoomState?.watchId ?? null,
      mismatch,
      invite: session?.roomId
        ? buildInvite(session.roomId, lastRoomState?.watchId ?? active?.watchId)
        : null
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
    broadcastToContent({
      type: MessageType.SESSION,
      session: publicSession(),
      clockOffsetMs
    });
  }

  function broadcastToContent(message) {
    for (const port of contentPorts.keys()) {
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
