"use strict";

globalThis.WatchHome = globalThis.WatchHome ?? {};

globalThis.WatchHome.Config = Object.freeze({
  backendOrigin: "__BACKEND_ORIGIN__",
  heartbeatIntervalMs: 3000,
  clockSyncIntervalMs: 12000,
  reconnectBaseDelayMs: 750,
  reconnectMaxDelayMs: 15000,
  guestCorrectionIntervalMs: 400,
});
