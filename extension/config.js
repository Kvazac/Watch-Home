"use strict";

globalThis.WatchHomeConfig = Object.freeze({
  backendHttpOrigin: "https://watch-home.ugnius-socials.workers.dev",
  backendWsOrigin: "wss://watch-home.ugnius-socials.workers.dev",
  heartbeatIntervalMs: 2500,
  clockSyncIntervalMs: 10000,
  hostStallDebounceMs: 200,
  reconnectBaseMs: 500,
  reconnectMaxMs: 10000
});
