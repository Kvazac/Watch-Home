"use strict";

const idleView = document.querySelector("#idle-view");
const sessionView = document.querySelector("#session-view");
const roomInput = document.querySelector("#room-input");
const createButton = document.querySelector("#create-button");
const joinButton = document.querySelector("#join-button");
const copyButton = document.querySelector("#copy-button");
const leaveButton = document.querySelector("#leave-button");
const reconnectButton = document.querySelector("#reconnect-button");
const openCorrectButton = document.querySelector("#open-correct-button");
const roomCode = document.querySelector("#room-code");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const roleText = document.querySelector("#role-text");
const participantsText = document.querySelector("#participants-text");
const messageBox = document.querySelector("#message");

let status = null;

createButton.addEventListener("click", async () => {
  setBusy(true);
  const response = await send({ type: "POPUP_CREATE" });
  setBusy(false);

  if (!response?.ok) {
    showMessage(response?.error ?? "Could not create the party.", true);
    return;
  }

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
    showMessage(response?.error ?? "Could not join the party.", true);
    return;
  }

  await refresh();
});

leaveButton.addEventListener("click", async () => {
  setBusy(true);
  await send({ type: "POPUP_LEAVE" });
  setBusy(false);
  await refresh();
});

reconnectButton.addEventListener("click", async () => {
  setBusy(true);
  await send({ type: "POPUP_RECONNECT" });
  setBusy(false);
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
    showMessage("Invite copied.");
  } catch {
    showMessage("Could not copy automatically.", true);
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
  showMessage("");

  if (!activeSession) {
    return;
  }

  roomCode.textContent = status.roomIdFormatted ?? "";
  statusText.textContent = statusLabel(activeSession.status);
  statusDot.classList.toggle("connected", activeSession.connected);
  roleText.textContent =
    activeSession.role === "host"
      ? "You are the host. Your playback controls the party."
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

  if (status.mismatch) {
    showMessage("This party is watching a different Netflix video.", true);
  } else if (activeSession.lastError) {
    showMessage(activeSession.lastError, true);
  }
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
    openCorrectButton
  ]) {
    button.disabled = busy;
  }
}

function showMessage(message, isError = false) {
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
