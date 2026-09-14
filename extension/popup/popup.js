// extension/popup/popup.js
"use strict";

const MESSAGE_DURATION_MS = 6000;
const COPY_MESSAGE_DURATION_MS = 3000;

const idleView = document.querySelector("#idle-view");
const sessionView = document.querySelector("#session-view");
const roomInput = document.querySelector("#room-input");
const createButton = document.querySelector("#create-button");
const joinButton = document.querySelector("#join-button");
const copyButton = document.querySelector("#copy-button");
const leaveButton = document.querySelector("#leave-button");
const reconnectButton = document.querySelector("#reconnect-button");
const openCorrectButton = document.querySelector("#open-correct-button");
const copyDiagnosticsButton = document.querySelector(
  "#copy-diagnostics-button"
);
const roomCode = document.querySelector("#room-code");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const roleText = document.querySelector("#role-text");
const participantsText = document.querySelector("#participants-text");
const messageBox = document.querySelector("#message");

const diagnosticsFields = {
  mode: document.querySelector("#diag-mode"),
  drift: document.querySelector("#diag-drift"),
  rtt: document.querySelector("#diag-rtt"),
  offset: document.querySelector("#diag-offset"),
  sequence: document.querySelector("#diag-sequence"),
  playLatency: document.querySelector("#diag-play-latency"),
  seekLatency: document.querySelector("#diag-seek-latency"),
  hardSeeks: document.querySelector("#diag-hard-seeks"),
  softCorrections: document.querySelector("#diag-soft-corrections")
};

let status = null;
let messageTimer = null;
let transientMessageUntil = 0;

createButton.addEventListener("click", async () => {
  setBusy(true);
  const response = await send({ type: "POPUP_CREATE" });
  setBusy(false);

  if (!response?.ok) {
    showTransientMessage(
      response?.error ?? "Could not create the party.",
      true
    );
    return;
  }

  clearMessage();
  await refresh();
});

joinButton.addEventListener("click", async () => {
  setBusy(true);
  const response = await send({
    type: "POPUP_JOIN",
    roomId: roomInput.value
  });
  setBusy(false);

  if (!response?.ok) {
    showTransientMessage(
      response?.error ?? "Could not join the party.",
      true
    );
    return;
  }

  clearMessage();
  await refresh();
});

leaveButton.addEventListener("click", async () => {
  setBusy(true);
  await send({ type: "POPUP_LEAVE" });
  setBusy(false);

  clearMessage();
  await refresh();
});

reconnectButton.addEventListener("click", async () => {
  setBusy(true);
  await send({ type: "POPUP_RECONNECT" });
  setBusy(false);

  clearMessage();
  await refresh();
});

openCorrectButton.addEventListener("click", async () => {
  await send({ type: "POPUP_OPEN_CORRECT" });
});

copyButton.addEventListener("click", async () => {
  if (!status?.invite) {
    return;
  }

  try {
    await navigator.clipboard.writeText(status.invite);
    showTransientMessage(
      "Invite copied.",
      false,
      COPY_MESSAGE_DURATION_MS
    );
  } catch {
    showTransientMessage("Could not copy automatically.", true);
  }
});

copyDiagnosticsButton.addEventListener("click", async () => {
  if (!status?.diagnostics) {
    return;
  }

  const diagnosticReport = {
    generatedAt: new Date().toISOString(),
    extensionVersion: browser.runtime.getManifest().version,
    role: status.session?.role ?? null,
    connected: status.session?.connected ?? false,
    participantCount: status.participantCount,
    mismatch: status.mismatch,
    diagnostics: status.diagnostics
  };

  try {
    await navigator.clipboard.writeText(
      JSON.stringify(diagnosticReport, null, 2)
    );
    showTransientMessage(
      "Diagnostics copied.",
      false,
      COPY_MESSAGE_DURATION_MS
    );
  } catch {
    showTransientMessage("Could not copy diagnostics.", true);
  }
});

roomInput.addEventListener("input", () => {
  const cleaned = roomInput.value
    .toUpperCase()
    .replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, "")
    .slice(0, 12);

  roomInput.value = cleaned.match(/.{1,4}/g)?.join("-") ?? "";
});

async function refresh() {
  status = await send({ type: "POPUP_GET_STATUS" });
  render();
}

function render() {
  const activeSession = status?.session ?? null;

  idleView.hidden = Boolean(activeSession);
  sessionView.hidden = !activeSession;

  if (!activeSession) {
    clearPersistentMessageIfAllowed();
    return;
  }

  roomCode.textContent = status.roomIdFormatted ?? "";
  statusText.textContent = statusLabel(activeSession.status);
  statusDot.classList.toggle("connected", activeSession.connected);

roleText.textContent =
  activeSession.role === "host"
    ? "You are the host. Your playback controls the party."
    : status.hostOnline === false
      ? "You are a guest. Waiting for the host to reconnect."
      : "You are a guest. Playback follows the host.";

  participantsText.textContent =
    status.participantCount > 0
      ? `${status.participantCount} participant${
          status.participantCount === 1 ? "" : "s"
        } connected`
      : "Waiting for connection";

  reconnectButton.hidden = ![
    "disconnected",
    "error",
    "configuration-error"
  ].includes(activeSession.status);

  openCorrectButton.hidden = !status.mismatch;

  renderDiagnostics(status.diagnostics);

  if (status.mismatch) {
    showPersistentMessage(
      "This party is watching a different Netflix video.",
      true
    );
    return;
  }

  if (activeSession.lastError) {
    showPersistentMessage(activeSession.lastError, true);
    return;
  }

  if (
    activeSession.role === "guest" &&
    status.hostOnline === false
  ) {
    showPersistentMessage("Host disconnected. Waiting for reconnect.");
    return;
  }

  clearPersistentMessageIfAllowed();
}

function renderDiagnostics(diagnostics) {
  const network = diagnostics?.network ?? {};
  const sync = diagnostics?.content?.sync ?? {};

  diagnosticsFields.mode.textContent = sync.mode ?? "—";
  diagnosticsFields.drift.textContent = formatMs(sync.driftMs);
  diagnosticsFields.rtt.textContent = formatMs(network.rttMs);
  diagnosticsFields.offset.textContent = formatSignedMs(
    network.clockOffsetMs
  );
  diagnosticsFields.sequence.textContent =
    network.sequence ?? sync.sequence ?? "—";
  diagnosticsFields.playLatency.textContent = formatMs(
    sync.playLatencyMs
  );
  diagnosticsFields.seekLatency.textContent = formatMs(
    sync.seekLatencyMs
  );
  diagnosticsFields.hardSeeks.textContent =
    sync.hardCorrectionCount ?? "—";
  diagnosticsFields.softCorrections.textContent =
    sync.softCorrectionCount ?? "—";
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "—";
}

function formatSignedMs(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded} ms`;
}

function statusLabel(value) {
  switch (value) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "configuration-error":
      return "Setup required";
    case "error":
      return "Connection error";
    default:
      return "Disconnected";
  }
}

function setBusy(busy) {
  for (const button of [
    createButton,
    joinButton,
    leaveButton,
    reconnectButton,
    openCorrectButton,
    copyDiagnosticsButton
  ]) {
    button.disabled = busy;
  }
}

function showTransientMessage(
  message,
  isError = false,
  durationMs = MESSAGE_DURATION_MS
) {
  clearMessageTimer();

  setMessage(message, isError);
  transientMessageUntil = Date.now() + durationMs;

  messageTimer = window.setTimeout(() => {
    messageTimer = null;
    transientMessageUntil = 0;
    render();
  }, durationMs);
}

function showPersistentMessage(message, isError = false) {
  if (Date.now() < transientMessageUntil) {
    return;
  }

  setMessage(message, isError);
}

function clearPersistentMessageIfAllowed() {
  if (Date.now() < transientMessageUntil) {
    return;
  }

  setMessage("", false);
}

function clearMessage() {
  clearMessageTimer();
  transientMessageUntil = 0;
  setMessage("", false);
}

function clearMessageTimer() {
  if (messageTimer !== null) {
    window.clearTimeout(messageTimer);
    messageTimer = null;
  }
}

function setMessage(message, isError) {
  messageBox.textContent = message;
  messageBox.classList.toggle("error", isError);
}

async function send(message) {
  try {
    return await browser.runtime.sendMessage(message);
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

void refresh();
window.setInterval(refresh, 1000);
