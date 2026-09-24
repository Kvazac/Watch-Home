"use strict";

(() => {
  const PROTOCOL_VERSION = 2;
  const ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const ROOM_LENGTH = 12;
  const ROOM_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/;

  const MessageType = Object.freeze({
    CONTENT_READY: "CONTENT_READY",
    SESSION: "SESSION",
    CLOCK: "CLOCK",
    HOST_STATE: "HOST_STATE",
    CONTROL_STATE: "CONTROL_STATE",
    CONTROL_REJECTED: "CONTROL_REJECTED",
    SET_CONTROL_MODE: "SET_CONTROL_MODE",
    ROOM_SETTINGS: "ROOM_SETTINGS",
    REQUEST_STATE: "REQUEST_STATE",
    ROOM_STATE: "ROOM_STATE",
    HOST_OFFLINE: "HOST_OFFLINE",
    PRESENCE: "PRESENCE",
    PLAYER_ERROR: "PLAYER_ERROR",
    DIAGNOSTICS: "DIAGNOSTICS",
    PING: "PING",
    PONG: "PONG",
    WELCOME: "WELCOME",
    ERROR: "ERROR",
    LEAVE: "LEAVE"
  });

  function normalizeRoomId(value) {
    return String(value ?? "")
      .toUpperCase()
      .replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, "")
      .slice(0, ROOM_LENGTH);
  }

  function formatRoomId(value) {
    const normalized = normalizeRoomId(value);
    return normalized.match(/.{1,4}/g)?.join("-") ?? "";
  }

  function isValidRoomId(value) {
    return ROOM_PATTERN.test(normalizeRoomId(value));
  }

  function createRoomId() {
    const bytes = new Uint8Array(ROOM_LENGTH);
    crypto.getRandomValues(bytes);
    let output = "";

    for (const byte of bytes) {
      output += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
    }

    return output;
  }

  function createClientId() {
    return crypto.randomUUID();
  }

  globalThis.WatchHomeProtocol = Object.freeze({
    PROTOCOL_VERSION,
    MessageType,
    ROOM_PATTERN,
    createClientId,
    createRoomId,
    formatRoomId,
    isValidRoomId,
    normalizeRoomId
  });
})();
