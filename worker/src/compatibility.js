export const PROTOCOL_VERSION = 2;
export const SERVER_RELEASE = "1.2.0";
export const SUPPORTED_CLIENT_VERSIONS = manifest.version;

export function checkClientCompatibility(protocolValue, clientVersion) {
  const protocolVersion = Number(protocolValue);
  const version = String(clientVersion ?? "");

  if (protocolVersion !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "PROTOCOL_MISMATCH",
      closeCode: 4406,
      message:
        `Client protocol ${Number.isFinite(protocolVersion) ? protocolVersion : "unknown"} ` +
        `is incompatible with server protocol ${PROTOCOL_VERSION}.`
    };
  }

  if (!SUPPORTED_CLIENT_VERSIONS.includes(version)) {
    return {
      ok: false,
      code: "CLIENT_VERSION_MISMATCH",
      closeCode: 4409,
      message:
        `Watch Home ${version || "unknown"} is not supported by server ${SERVER_RELEASE}.`
    };
  }

  return {
    ok: true,
    protocolVersion,
    clientVersion: version
  };
}


export function checkRoomClientCompatibility(roomClientVersion, clientVersion) {
  const roomVersion =
    typeof roomClientVersion === "string" && roomClientVersion
      ? roomClientVersion
      : null;
  const version = String(clientVersion ?? "");

  if (!roomVersion) {
    return {
      ok: true,
      roomClientVersion: null,
      clientVersion: version
    };
  }

  if (roomVersion !== version) {
    return {
      ok: false,
      code: "ROOM_CLIENT_VERSION_MISMATCH",
      closeCode: 4409,
      message:
        `This party requires Watch Home ${roomVersion}. ` +
        `This client is ${version || "unknown"}.`
    };
  }

  return {
    ok: true,
    roomClientVersion: roomVersion,
    clientVersion: version
  };
}
