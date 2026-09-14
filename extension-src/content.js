"use strict";

globalThis.WatchHome = globalThis.WatchHome ?? {};

const SESSION_STORAGE_KEY = "watchHomeSession";
const HOST_STALL_DEBOUNCE_MS = 200;

const player = new WatchHome.NetflixPlayer();
const clock = new WatchHome.ClockEstimator();
const synchronizer = new WatchHome.SyncController(player, clock);

let currentSession = null;
let connected = false;
let participants = 0;
let lastError = null;
let heartbeatTimer = null;
let hostStallTimer = null;
let hostStalled = false;

const client = new WatchHome.PartyClient(clock, {
  onConnection(isConnected) {
    connected = isConnected;
  },
  onParticipants(count) {
    participants = Number(count) || 0;
  },
  onRole(role, authenticated) {
    if (currentSession?.role === "host" && !authenticated) {
      lastError = "Host authentication failed.";
      return;
    }

    synchronizer.setRole(role);

    if (role === "host") {
      sendHostSnapshot(false);
      startHeartbeat();
    }
  },
  onState(state) {
    if (!state) {
      return;
    }

    const mediaId = player.getMediaId();
    if (mediaId && state.mediaId !== mediaId) {
      lastError = "This room is watching a different Netflix title.";
      return;
    }

    synchronizer.setState(state);
  },
  onError(message) {
    lastError = message;
  },
});

player.subscribe(({ type, snapshot }) => {
  if (!snapshot || currentSession?.role !== "host") {
    return;
  }

  if (type === "waiting" && !snapshot.paused) {
    clearTimeout(hostStallTimer);
    hostStallTimer = setTimeout(() => {
      const latest = player.getSnapshot();
      if (latest && !latest.paused && latest.readyState < 3) {
        hostStalled = true;
        client.sendHostState(latest, true);
      }
    }, HOST_STALL_DEBOUNCE_MS);
    return;
  }

  if (type === "playing") {
    clearTimeout(hostStallTimer);
    if (hostStalled) {
      hostStalled = false;
    }
    client.sendHostState(snapshot, false);
    return;
  }

  if (["play", "pause", "seeked", "ratechange", "ended"].includes(type)) {
    clearTimeout(hostStallTimer);
    hostStalled = false;
    client.sendHostState(snapshot, false);
  }
});

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    sendHostSnapshot(hostStalled);
  }, WatchHome.Config.heartbeatIntervalMs);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function sendHostSnapshot(stalled) {
  if (currentSession?.role !== "host") {
    return;
  }

  const snapshot = player.getSnapshot();
  if (snapshot) {
    client.sendHostState(snapshot, stalled);
  }
}

function formatRoomId(roomId) {
  if (!roomId) {
    return "";
  }
  return roomId.match(/.{1,4}/g)?.join("-") ?? roomId;
}

function status() {
  const snapshot = player.getSnapshot();

  return {
    available: Boolean(snapshot?.mediaId),
    connected,
    participants,
    roomId: currentSession?.roomId
      ? formatRoomId(currentSession.roomId)
      : null,
    role: currentSession?.role ?? null,
    mediaId: snapshot?.mediaId ?? null,
    watchUrl: snapshot?.mediaId
      ? `https://www.netflix.com/watch/${snapshot.mediaId}`
      : null,
    error: lastError,
  };
}

async function createParty() {
  lastError = null;
  const snapshot = player.getSnapshot();

  if (!snapshot?.mediaId) {
    throw new Error("Open a Netflix movie or episode first.");
  }

  const room = await client.createRoom(snapshot);
  currentSession = {
    roomId: room.roomId,
    hostToken: room.hostToken,
    role: "host",
    mediaId: snapshot.mediaId,
  };

  await browser.storage.local.set({
    [SESSION_STORAGE_KEY]: currentSession,
  });

  return status();
}

async function joinParty(roomId) {
  lastError = null;
  const snapshot = player.getSnapshot();

  if (!snapshot?.mediaId) {
    throw new Error("Open the Netflix title from the host's invite first.");
  }

  const normalizedRoomId = String(roomId ?? "")
    .replaceAll("-", "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z2-9]{12}$/.test(normalizedRoomId)) {
    throw new Error("Room codes contain 12 letters/numbers.");
  }

  currentSession = {
    roomId: normalizedRoomId,
    hostToken: null,
    role: "guest",
    mediaId: snapshot.mediaId,
  };

  await client.connect(currentSession);
  await browser.storage.local.set({
    [SESSION_STORAGE_KEY]: currentSession,
  });

  synchronizer.setRole("guest");
  stopHeartbeat();
  return status();
}

async function leaveParty() {
  client.disconnect();
  synchronizer.setRole("guest");
  synchronizer.setState(null);
  stopHeartbeat();
  connected = false;
  participants = 0;
  currentSession = null;
  lastError = null;
  await browser.storage.local.remove(SESSION_STORAGE_KEY);
  return status();
}

async function restoreSession() {
  const stored = await browser.storage.local.get(SESSION_STORAGE_KEY);
  const session = stored[SESSION_STORAGE_KEY];

  if (!session || session.mediaId !== player.getMediaId()) {
    return;
  }

  currentSession = session;

  try {
    await client.connect(session);
    if (session.role === "guest") {
      synchronizer.setRole("guest");
    }
  } catch (error) {
    lastError = error.message;
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type !== "WATCH_HOME_POPUP") {
    return undefined;
  }

  if (message.command === "STATUS") {
    return Promise.resolve(status());
  }

  if (message.command === "CREATE") {
    return createParty()
      .then((result) => ({ ok: true, status: result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }

  if (message.command === "JOIN") {
    return joinParty(message.roomId)
      .then((result) => ({ ok: true, status: result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }

  if (message.command === "LEAVE") {
    return leaveParty()
      .then((result) => ({ ok: true, status: result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }

  return Promise.resolve({ ok: false, error: "Unknown command." });
});

restoreSession();
