const ROOM_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/;
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(["playing", "paused", "stalled", "offline"]);

export function isValidRoomId(roomId) {
  return ROOM_PATTERN.test(String(roomId ?? ""));
}

export function isValidClientId(clientId) {
  return CLIENT_ID_PATTERN.test(String(clientId ?? ""));
}

export function sanitizeHostState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const watchId = String(value.watchId ?? "");
  const position = Number(value.position);
  const playbackRate = Number(value.playbackRate);
  const mode = String(value.mode ?? "");

  if (!/^\d{1,32}$/.test(watchId)) {
    return null;
  }

  if (!Number.isFinite(position) || position < 0 || position > 86400) {
    return null;
  }

  if (
    !Number.isFinite(playbackRate) ||
    playbackRate < 0.25 ||
    playbackRate > 4
  ) {
    return null;
  }

  if (!MODES.has(mode)) {
    return null;
  }

  return {
    watchId,
    position,
    playbackRate,
    mode
  };
}

export function clampAnchorTime(estimatedServerTime, serverNow) {
  const candidate = Number(estimatedServerTime);

  if (!Number.isFinite(candidate)) {
    return serverNow;
  }

  if (Math.abs(candidate - serverNow) > 2000) {
    return serverNow;
  }

  return candidate;
}

export function freezeCanonicalState(canonicalState, serverNow) {
  if (!canonicalState) {
    return null;
  }

  if (canonicalState.mode !== "playing") {
    return {
      ...canonicalState,
      mode: "offline",
      anchorServerTime: serverNow
    };
  }

  const elapsedSeconds = Math.max(
    0,
    (serverNow - canonicalState.anchorServerTime) / 1000
  );

  return {
    ...canonicalState,
    mode: "offline",
    position:
      canonicalState.position +
      elapsedSeconds * canonicalState.playbackRate,
    anchorServerTime: serverNow
  };
}
