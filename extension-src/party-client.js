"use strict";

globalThis.WatchHome = globalThis.WatchHome ?? {};

class PartyClient {
  constructor(clock, handlers = {}) {
    this.clock = clock;
    this.handlers = handlers;
    this.webSocket = null;
    this.roomId = null;
    this.hostToken = null;
    this.role = "guest";
    this.requestedRole = "guest";
    this.manualClose = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  async createRoom(snapshot) {
    const response = await fetch(`${WatchHome.Config.backendOrigin}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mediaId: snapshot.mediaId,
        position: snapshot.position,
        paused: snapshot.paused,
        playbackRate: snapshot.playbackRate,
      }),
    });

    if (!response.ok) {
      throw new Error(`Room creation failed (${response.status}).`);
    }

    const data = await response.json();
    await this.connect({
      roomId: data.roomId,
      hostToken: data.hostToken,
      role: "host",
    });

    return data;
  }

  async connect({ roomId, hostToken = null, role = "guest" }) {
    this.disconnect(false);

    this.roomId = String(roomId).replaceAll("-", "").toUpperCase();
    this.hostToken = hostToken;
    this.requestedRole = role;
    this.role = "guest";
    this.manualClose = false;

    return new Promise((resolve, reject) => {
      const websocketUrl = new URL(
        `${WatchHome.Config.backendOrigin}/api/rooms/${this.roomId}/ws`,
      );
      websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";

      const socket = new WebSocket(websocketUrl);
      this.webSocket = socket;

      let settled = false;

      socket.addEventListener("open", () => {
        this.reconnectAttempt = 0;
        this.startClockSync();

        if (this.hostToken) {
          this.send({ type: "AUTH_HOST", hostToken: this.hostToken });
        }

        if (!settled) {
          settled = true;
          resolve();
        }
      });

      socket.addEventListener("message", (event) => this.handleMessage(event));

      socket.addEventListener("close", () => {
        if (this.webSocket !== socket) {
          return;
        }

        this.stopClockSync();
        this.handlers.onConnection?.(false);

        if (!this.manualClose) {
          this.scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          reject(new Error("Could not connect to the watch-party server."));
        }
      });
    });
  }

  disconnect(clearSession = true) {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    this.stopClockSync();

    if (this.webSocket) {
      this.webSocket.close(1000, "Leaving party");
      this.webSocket = null;
    }

    if (clearSession) {
      this.roomId = null;
      this.hostToken = null;
      this.role = "guest";
      this.requestedRole = "guest";
    }
  }

  sendHostState(snapshot, stalled = false) {
    if (this.role !== "host" || !snapshot) {
      return;
    }

    this.send({
      type: "HOST_STATE",
      mediaId: snapshot.mediaId,
      position: snapshot.position,
      paused: stalled ? true : snapshot.paused,
      stalled,
      playbackRate: snapshot.playbackRate,
      anchorServerTime: this.clock.serverNow(),
    });
  }

  send(message) {
    if (this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "WELCOME") {
      this.handlers.onConnection?.(true);
      this.handlers.onParticipants?.(message.participants);
      this.handlers.onState?.(message.state);
      return;
    }

    if (message.type === "AUTH_RESULT") {
      if (message.ok) {
        this.role = "host";
      }
      this.handlers.onRole?.(this.role, Boolean(message.ok));
      this.handlers.onState?.(message.state);
      return;
    }

    if (message.type === "PONG") {
      this.clock.addSample(
        message.clientSentAt,
        Date.now(),
        message.serverTime,
      );
      return;
    }

    if (message.type === "STATE") {
      this.handlers.onState?.(message.state);
      return;
    }

    if (message.type === "PARTICIPANTS") {
      this.handlers.onParticipants?.(message.participants);
      return;
    }

    if (message.type === "ERROR") {
      this.handlers.onError?.(message.message);
    }
  }

  startClockSync() {
    this.stopClockSync();
    this.sendPing();
    this.pingTimer = setInterval(
      () => this.sendPing(),
      WatchHome.Config.clockSyncIntervalMs,
    );
  }

  stopClockSync() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  sendPing() {
    this.send({ type: "PING", clientSentAt: Date.now() });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const exponent = Math.min(this.reconnectAttempt, 6);
    const delay = Math.min(
      WatchHome.Config.reconnectBaseDelayMs * 2 ** exponent,
      WatchHome.Config.reconnectMaxDelayMs,
    );

    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.roomId || this.manualClose) {
        return;
      }

      this.connect({
        roomId: this.roomId,
        hostToken: this.hostToken,
        role: this.requestedRole,
      }).catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }
}

globalThis.WatchHome.PartyClient = PartyClient;
