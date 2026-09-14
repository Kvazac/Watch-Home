import { DurableObject } from "cloudflare:workers";

const ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 12;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ANCHOR_CLOCK_ERROR_MS = 2_000;

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      ...extraHeaders,
    },
  });
}

function generateRoomCode() {
  const rejectionLimit =
    Math.floor(256 / ROOM_ALPHABET.length) * ROOM_ALPHABET.length;
  let roomCode = "";

  while (roomCode.length < ROOM_CODE_LENGTH) {
    const bytes = new Uint8Array(ROOM_CODE_LENGTH * 2);
    crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= rejectionLimit) {
        continue;
      }

      roomCode += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
      if (roomCode.length === ROOM_CODE_LENGTH) {
        break;
      }
    }
  }

  return roomCode;
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizedPlaybackRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) {
    return 1;
  }
  return rate;
}

function normalizedPosition(value) {
  const position = Number(value);
  if (!Number.isFinite(position) || position < 0) {
    return 0;
  }
  return position;
}

function normalizedMediaId(value) {
  const mediaId = String(value ?? "").trim();
  if (!/^\d{1,32}$/.test(mediaId)) {
    return null;
  }
  return mediaId;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "watch-home" });
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      return createRoom(request, env);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{12})\/ws$/);
    if (match && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return jsonResponse({ error: "WebSocket upgrade required." }, 426);
      }

      const roomId = match[1];
      const durableObjectId = env.PARTY_ROOMS.idFromName(roomId);
      return env.PARTY_ROOMS.get(durableObjectId).fetch(request);
    }

    return jsonResponse({ error: "Not found." }, 404);
  },
};

async function createRoom(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const mediaId = normalizedMediaId(body.mediaId);
  if (!mediaId) {
    return jsonResponse({ error: "A valid Netflix media ID is required." }, 400);
  }

  const initialState = {
    mediaId,
    paused: Boolean(body.paused),
    stalled: false,
    playbackRate: normalizedPlaybackRate(body.playbackRate),
    anchorPosition: normalizedPosition(body.position),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = generateRoomCode();
    const hostToken = generateToken();
    const hostTokenHash = await sha256Hex(hostToken);
    const durableObjectId = env.PARTY_ROOMS.idFromName(roomId);
    const stub = env.PARTY_ROOMS.get(durableObjectId);

    const response = await stub.fetch("https://room.internal/initialize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomId, hostTokenHash, initialState }),
    });

    if (response.status === 201) {
      return jsonResponse({ roomId, hostToken }, 201);
    }

    if (response.status !== 409) {
      return jsonResponse({ error: "Could not create room." }, 500);
    }
  }

  return jsonResponse({ error: "Could not allocate a unique room." }, 503);
}

export class PartyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = null;
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get("room")) ?? null;
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);

    if (url.hostname === "room.internal" && url.pathname === "/initialize") {
      return this.initialize(request);
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse({ error: "WebSocket upgrade required." }, 426);
    }

    if (!this.room) {
      return jsonResponse({ error: "Room does not exist or has expired." }, 404);
    }

    const [client, server] = Object.values(new WebSocketPair());
    const clientId = crypto.randomUUID();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ clientId, role: "guest" });

    server.send(
      JSON.stringify({
        type: "WELCOME",
        clientId,
        role: "guest",
        serverTime: Date.now(),
        state: this.publicState(),
        participants: this.ctx.getWebSockets().length,
      }),
    );

    this.broadcastParticipants();
    await this.touch();

    return new Response(null, { status: 101, webSocket: client });
  }

  async initialize(request) {
    if (this.room) {
      return new Response(null, { status: 409 });
    }

    const body = await request.json();
    const now = Date.now();
    this.room = {
      roomId: body.roomId,
      hostTokenHash: body.hostTokenHash,
      mediaId: body.initialState.mediaId,
      paused: body.initialState.paused,
      stalled: false,
      playbackRate: body.initialState.playbackRate,
      anchorPosition: body.initialState.anchorPosition,
      anchorServerTime: now,
      sequence: 1,
      createdAt: now,
      lastActivity: now,
    };

    await this.ctx.storage.put("room", this.room);
    await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);
    return new Response(null, { status: 201 });
  }

  async webSocketMessage(webSocket, rawMessage) {
    await this.ready;

    let message;
    try {
      message = JSON.parse(String(rawMessage));
    } catch {
      this.send(webSocket, { type: "ERROR", message: "Invalid JSON message." });
      return;
    }

    const attachment = webSocket.deserializeAttachment() ?? {
      clientId: crypto.randomUUID(),
      role: "guest",
    };

    if (message.type === "PING") {
      this.send(webSocket, {
        type: "PONG",
        clientSentAt: Number(message.clientSentAt),
        serverTime: Date.now(),
      });
      return;
    }

    if (message.type === "AUTH_HOST") {
      const tokenHash = await sha256Hex(String(message.hostToken ?? ""));
      const ok = Boolean(this.room && tokenHash === this.room.hostTokenHash);

      if (ok) {
        attachment.role = "host";
        webSocket.serializeAttachment(attachment);
      }

      this.send(webSocket, {
        type: "AUTH_RESULT",
        ok,
        role: ok ? "host" : "guest",
        serverTime: Date.now(),
        state: this.publicState(),
      });
      await this.touch();
      return;
    }

    if (message.type === "HOST_STATE") {
      if (attachment.role !== "host") {
        this.send(webSocket, {
          type: "ERROR",
          message: "Only the authenticated host can update playback state.",
        });
        return;
      }

      await this.applyHostState(message);
      return;
    }

    this.send(webSocket, { type: "ERROR", message: "Unknown message type." });
  }

  async webSocketClose() {
    await this.ready;
    this.broadcastParticipants();
    await this.touch();
  }

  async webSocketError() {
    await this.ready;
    this.broadcastParticipants();
    await this.touch();
  }

  async alarm() {
    await this.ready;

    if (!this.room) {
      return;
    }

    const now = Date.now();
    const sockets = this.ctx.getWebSockets();

    if (sockets.length === 0 && now - this.room.lastActivity >= ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }

    await this.ctx.storage.setAlarm(
      Math.max(now + 60_000, this.room.lastActivity + ROOM_TTL_MS),
    );
  }

  async applyHostState(message) {
    if (!this.room) {
      return;
    }

    const now = Date.now();
    const requestedAnchorTime = Number(message.anchorServerTime);
    const anchorServerTime =
      Number.isFinite(requestedAnchorTime) &&
      Math.abs(requestedAnchorTime - now) <= MAX_ANCHOR_CLOCK_ERROR_MS
        ? requestedAnchorTime
        : now;

    const mediaId = normalizedMediaId(message.mediaId);
    if (!mediaId || mediaId !== this.room.mediaId) {
      return;
    }

    this.room = {
      ...this.room,
      paused: Boolean(message.paused),
      stalled: Boolean(message.stalled),
      playbackRate: normalizedPlaybackRate(message.playbackRate),
      anchorPosition: normalizedPosition(message.position),
      anchorServerTime,
      sequence: this.room.sequence + 1,
      lastActivity: now,
    };

    await this.ctx.storage.put("room", this.room);
    await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);

    this.broadcast({
      type: "STATE",
      serverTime: now,
      state: this.publicState(),
    });
  }

  publicState() {
    if (!this.room) {
      return null;
    }

    return {
      mediaId: this.room.mediaId,
      paused: this.room.paused,
      stalled: this.room.stalled,
      playbackRate: this.room.playbackRate,
      anchorPosition: this.room.anchorPosition,
      anchorServerTime: this.room.anchorServerTime,
      sequence: this.room.sequence,
    };
  }

  async touch() {
    if (!this.room) {
      return;
    }

    const now = Date.now();
    this.room.lastActivity = now;
    await this.ctx.storage.put("room", this.room);
    await this.ctx.storage.setAlarm(now + ROOM_TTL_MS);
  }

  broadcastParticipants() {
    this.broadcast({
      type: "PARTICIPANTS",
      participants: this.ctx.getWebSockets().length,
      serverTime: Date.now(),
    });
  }

  broadcast(message) {
    const encoded = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(encoded);
      } catch {
        // A close event will remove dead sockets from the runtime set.
      }
    }
  }

  send(socket, message) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // The caller's reconnect path handles delivery failure.
    }
  }
}
