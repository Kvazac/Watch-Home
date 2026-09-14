"use strict";

const statusElement = document.querySelector("#status");
const idlePanel = document.querySelector("#idle-panel");
const partyPanel = document.querySelector("#party-panel");
const roomInput = document.querySelector("#room-input");
const roomCode = document.querySelector("#room-code");
const partyDetails = document.querySelector("#party-details");
const errorElement = document.querySelector("#error");
const createButton = document.querySelector("#create-button");
const joinButton = document.querySelector("#join-button");
const copyButton = document.querySelector("#copy-button");
const leaveButton = document.querySelector("#leave-button");

let currentStatus = null;

async function activeNetflixTab() {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id || !tab.url?.startsWith("https://www.netflix.com/watch/")) {
    throw new Error("Open a Netflix movie or episode in this tab.");
  }

  return tab;
}

async function send(command, extra = {}) {
  const tab = await activeNetflixTab();
  return browser.tabs.sendMessage(tab.id, {
    type: "WATCH_HOME_POPUP",
    command,
    ...extra,
  });
}

function setBusy(busy) {
  for (const button of [createButton, joinButton, copyButton, leaveButton]) {
    button.disabled = busy;
  }
}

function showError(message) {
  errorElement.textContent = message;
  errorElement.hidden = !message;
}

function render(status) {
  currentStatus = status;
  showError(status?.error ?? "");

  if (!status?.available) {
    statusElement.textContent = "Open a Netflix movie or episode.";
    idlePanel.hidden = false;
    partyPanel.hidden = true;
    return;
  }

  if (!status.roomId) {
    statusElement.textContent = "Ready to start or join a party.";
    idlePanel.hidden = false;
    partyPanel.hidden = true;
    return;
  }

  statusElement.textContent = status.connected
    ? "● Connected"
    : "Reconnecting…";
  idlePanel.hidden = true;
  partyPanel.hidden = false;
  roomCode.textContent = status.roomId;

  const role = status.role === "host" ? "Host" : "Guest";
  const people = status.participants === 1 ? "1 person" : `${status.participants} people`;
  partyDetails.textContent = `${role} · ${people} connected`;
}

async function refresh() {
  try {
    const result = await send("STATUS");
    render(result);
  } catch (error) {
    render({ available: false, error: error.message });
  }
}

createButton.addEventListener("click", async () => {
  setBusy(true);
  showError("");

  try {
    const result = await send("CREATE");
    if (!result.ok) {
      throw new Error(result.error);
    }
    render(result.status);
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

joinButton.addEventListener("click", async () => {
  setBusy(true);
  showError("");

  try {
    const result = await send("JOIN", { roomId: roomInput.value });
    if (!result.ok) {
      throw new Error(result.error);
    }
    render(result.status);
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!currentStatus?.roomId || !currentStatus?.watchUrl) {
    return;
  }

  const invite = [
    "Watch Home",
    "",
    currentStatus.watchUrl,
    "",
    `Room: ${currentStatus.roomId}`,
  ].join("\n");

  try {
    await navigator.clipboard.writeText(invite);
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy invite";
    }, 1200);
  } catch {
    showError("Could not copy the invite. Copy the room code manually.");
  }
});

leaveButton.addEventListener("click", async () => {
  setBusy(true);
  showError("");

  try {
    const result = await send("LEAVE");
    if (!result.ok) {
      throw new Error(result.error);
    }
    render(result.status);
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
});

refresh();
