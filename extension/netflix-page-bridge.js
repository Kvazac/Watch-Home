"use strict";

(() => {
  const REQUEST_EVENT = "watch-home:netflix-command";
  const RESPONSE_EVENT = "watch-home:netflix-response";
  const MAX_SEEK_MS = 24 * 60 * 60 * 1000;

  document.addEventListener(REQUEST_EVENT, handleCommand);

  function handleCommand(event) {
    const request = parseRequest(event.detail);

    if (!request?.id || !request.command) {
      return;
    }

    try {
      switch (request.command) {
        case "seek":
          handleSeek(request);
          break;

        default:
          respond(
            request.id,
            false,
            `Unsupported Netflix command: ${request.command}`
          );
          break;
      }
    } catch (error) {
      respond(
        request.id,
        false,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  function handleSeek(request) {
    const positionMs = Number(request.payload?.positionMs);

    if (
      !Number.isFinite(positionMs) ||
      positionMs < 0 ||
      positionMs > MAX_SEEK_MS
    ) {
      respond(request.id, false, "Invalid seek position.");
      return;
    }

    const player = getNetflixPlayer();

    if (!player || typeof player.seek !== "function") {
      respond(request.id, false, "Netflix player API is unavailable.");
      return;
    }

    player.seek(Math.round(positionMs));
    respond(request.id, true, null);
  }

  function getNetflixPlayer() {
    const api =
      window.netflix?.appContext?.state?.playerApp?.getAPI?.();

    const videoPlayer = api?.videoPlayer;

    if (!videoPlayer) {
      return null;
    }

    const sessionIds =
      videoPlayer.getAllPlayerSessionIds?.() ?? [];

    if (!sessionIds.length) {
      return null;
    }

    const watchSessionIds = sessionIds.filter((sessionId) =>
      String(sessionId).toLowerCase().includes("watch")
    );

    const sessionId =
      watchSessionIds.at(-1) ??
      sessionIds.at(-1);

    if (!sessionId) {
      return null;
    }

    return (
      videoPlayer.getVideoPlayerBySessionId?.(sessionId) ??
      null
    );
  }

  function parseRequest(detail) {
    if (typeof detail !== "string") {
      return null;
    }

    try {
      return JSON.parse(detail);
    } catch {
      return null;
    }
  }

  function respond(id, ok, error) {
    const detail = JSON.stringify({
      id,
      ok,
      error
    });

    document.dispatchEvent(
      new CustomEvent(RESPONSE_EVENT, {
        detail
      })
    );
  }
})();
