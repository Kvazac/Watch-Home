import { DurableObject } from "cloudflare:workers";

import {
  clampAnchorTime,
  freezeCanonicalState,
  isValidClientId,
  sanitizeHostState
} from "./validation.js";

const MAX_CONNECTIONS = 12;
const MAX_MESSAGE_BYTES = 16 * 1024;

export class PartyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = {
      hostClientId: null,
      canonical: null,
      sequence: 0
    };

    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get("room");
      if (stored) {
        this.room = stored;
      }
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const url = new URL(request.url);
    const desiredRole = url.searchParams.get("role");
    const clientId = url.searchParams.get("clientId");

    if (!["host", "guest"].includes(desiredRole) || !isValidClientId(clientId)) {
      return new Response("Invalid connection parameters.", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (this.openSockets().length >= MAX_CONNECTIONS) {
      server.accept();
      this.send(server, {
        type: "ERROR",
        code: "ROOM_FULL",
        retryable: false,
        message: "This room is full."
      });
      server.close(4008, "Room full");

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    const assignedRole = await this.assignRole(desiredRole, clientId);
    if (!assignedRole) {
      server.accept();
      this.send(server, {
        type: "ERROR",
        code:
          desiredRole === "host"
            ? "HOST_CONFLICT"
            : "ROOM_NOT_READY",
        retryable: false,
        message:
          desiredRole === "host"
            ? "This room already has a different host."
            : "The host is no longer available for this room."
      });
      server.close(4003, "Role rejected");

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      clientId,
      role: assignedRole
    });

    this.send(server, {
      type: "WELCOME",
      role: assignedRole,
      state: this.room.canonical,
      participantCount: this.openSockets().length,
      serverTime: Date.now()
    });

    this.broadcastPresence();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(webSocket, rawMessage) {
    if (
      typeof rawMessage !== "string" ||
      new TextEncoder().encode(rawMessage).byteLength > MAX_MESSAGE_BYTES
    ) {
      this.send(webSocket, {
        type: "ERROR",
        code: "INVALID_MESSAGE",
        retryable: true,
        message: "Invalid message."
      });
      return;
    }

    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const attachment = webSocket.deserializeAttachment() ?? {};

    switch (message.type) {
      case "PING":
        this.send(webSocket, {
          type: "PONG",
          clientSentAt: message.clientSentAt,
          serverTime: Date.now()
        });
        break;

      case "REQUEST_STATE":
        if (this.room.canonical) {
          this.send(webSocket, {
            type: "ROOM_STATE",
            state: this.room.canonical
          });
        }
        break;

      case "HOST_STATE":
        if (
          attachment.role !== "host" ||
          attachment.clientId !== this.room.hostClientId
        ) {
          return;
        }

        await this.updateCanonicalState(message);
        break;

      case "LEAVE":
        webSocket.close(1000, "Client left");
        break;

      default:
        break;
    }
  }

  async webSocketClose(webSocket) {
    await this.handleSocketGone(webSocket);
  }

  async webSocketError(webSocket) {
    await this.handleSocketGone(webSocket);
  }

  async assignRole(desiredRole, clientId) {
    if (desiredRole === "host") {
      if (
        this.room.hostClientId &&
        this.room.hostClientId !== clientId
      ) {
        return null;
      }

      if (!this.room.hostClientId) {
        this.room.hostClientId = clientId;
        await this.persistRoom();
      }

      return "host";
    }

    if (!this.room.hostClientId) {
      return null;
    }

    return "guest";
  }

  async updateCanonicalState(message) {
    const sanitized = sanitizeHostState(message.state);
    if (!sanitized) {
      return;
    }

    const serverNow = Date.now();
    const anchorServerTime = clampAnchorTime(
      message.estimatedServerTime,
      serverNow
    );

    this.room.sequence += 1;
    this.room.canonical = {
      ...sanitized,
      anchorServerTime,
      sequence: this.room.sequence
    };

    await this.persistRoom();

    this.broadcast({
      type: "ROOM_STATE",
      state: this.room.canonical
    });
  }

  async handleSocketGone(webSocket) {
    const attachment = webSocket.deserializeAttachment() ?? {};

    if (
      attachment.role === "host" &&
      attachment.clientId === this.room.hostClientId
    ) {
      const serverNow = Date.now();
      this.room.canonical = freezeCanonicalState(
        this.room.canonical,
        serverNow
      );

      if (this.room.canonical) {
        this.room.sequence += 1;
        this.room.canonical.sequence = this.room.sequence;
      }

      await this.persistRoom();

      this.broadcast({
        type: "HOST_OFFLINE",
        state: this.room.canonical
      });
    }

    const remaining = this.openSockets(webSocket);

    if (remaining.length === 0) {
      await this.ctx.storage.deleteAll();
      this.room = {
        hostClientId: null,
        canonical: null,
        sequence: 0
      };
      return;
    }

    this.broadcastPresence();
  }

  broadcastPresence() {
    this.broadcast({
      type: "PRESENCE",
      participantCount: this.openSockets().length
    });
  }

  openSockets(excluded = null) {
    return this.ctx
      .getWebSockets()
      .filter(
        (webSocket) =>
          webSocket !== excluded &&
          webSocket.readyState === 1
      );
  }

  broadcast(payload) {
    for (const webSocket of this.openSockets()) {
      this.send(webSocket, payload);
    }
  }

  send(webSocket, payload) {
    try {
      webSocket.send(JSON.stringify(payload));
    } catch {
      // A closing socket can disappear between enumeration and send.
    }
  }

  async persistRoom() {
    await this.ctx.storage.put("room", this.room);
  }
}
