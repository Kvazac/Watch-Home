import { PartyRoom } from "./party-room.js";
import {
  PROTOCOL_VERSION,
  SERVER_RELEASE,
  SUPPORTED_CLIENT_VERSIONS
} from "./compatibility.js";
import { isValidRoomId } from "./validation.js";

export { PartyRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "watch-home",
        protocol: PROTOCOL_VERSION,
        release: SERVER_RELEASE,
        supportedClientVersions: SUPPORTED_CLIENT_VERSIONS
      });
    }

    const match = url.pathname.match(/^\/ws\/([^/]+)$/);

    if (!match || request.method !== "GET") {
      return new Response("Not found.", { status: 404 });
    }

    const roomId = match[1];

    if (!isValidRoomId(roomId)) {
      return new Response("Invalid room ID.", { status: 400 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade.", { status: 426 });
    }

    const id = env.PARTY_ROOM.idFromName(roomId);
    const stub = env.PARTY_ROOM.get(id);

    return stub.fetch(request);
  }
};
