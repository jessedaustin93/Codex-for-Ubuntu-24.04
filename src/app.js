const api = window.codexLinux;
const state = {
  connected: false,
  workspace: "",
  threadId: null,
  turnId: null,
  streamingMessage: null,
  approvals: new Map()
};

const elements = {
  workspacePath: document.querySelector("#workspacePath"),
  workspaceName: document.querySelector("#workspaceName"),
  workspaceButton: document.querySelector("#workspaceButton"),
  newThreadButton: document.querySelector("#newThreadButton"),
  composer: document.querySelector("#composer"),
  promptInput: document.querySelector("#promptInput"),
  messages: document.querySelector("#messages"),
  headerStatus: document.querySelector("#headerStatus"),
  connectionStatus: document.querySelector("#connectionStatus"),
  platformStatus: document.querySelector("#platformStatus"),
  interruptButton: document.querySelector("#interruptButton"),
  memoryButton: document.querySelector("#memoryButton"),
  memoryCount: document.querySelector("#memoryCount"),
  memorySearch: document.querySelector("#memorySearch"),
  memoryResults: document.querySelector("#memoryResults"),
  memoryToggle: document.querySelector("#memoryToggle"),
  dialogMemoryToggle: document.querySelector("#dialogMemoryToggle"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  searchButton: document.querySelector("#searchButton")
};

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function setStatus(status) {
  const lightClass = status.state === "connected" ? "" : status.state === "error" ? "error" : "offline";
  elements.connectionStatus.innerHTML = `<i class="status-light ${lightClass}"></i> ${escapeHtml(status.message || "Codex CLI offline")}`;
  elements.headerStatus.innerHTML = `<span class="pulse"></span> ${escapeHtml(status.message || status.state)}`;
  state.connected = status.state === "connected";
  if (status.platform) elements.platformStatus.textContent = status.platform;
}

function scrollMessages() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function appendUserMessage(text) {
  const article = document.createElement("article");
  article.className = "message user-message";
  article.innerHTML = `
    <div class="avatar user-avatar">WU</div>
    <div>
      <div class="message-meta"><strong>You</strong><time>now</time></div>
      <p>${escapeHtml(text)}</p>
    </div>`;
  elements.messages.append(article);
  scrollMessages();
}

function ensureStreamingMessage() {
  if (state.streamingMessage) return state.streamingMessage;
  const article = document.createElement("article");
  article.className = "message assistant-message";
  article.innerHTML = `
    <div class="avatar assistant-avatar">C</div>
    <div class="message-body">
      <div class="message-meta"><strong>Codex</strong><span class="working-label">Working</span></div>
      <p class="streaming-text"></p>
    </div>`;
  elements.messages.append(article);
  state.streamingMessage = article;
  return article;
}

function appendDelta(text) {
  const article = ensureStreamingMessage();
  const target = article.querySelector(".streaming-text");
  target.textContent += text;
  scrollMessages();
}

function finishStreaming() {
  if (!state.streamingMessage) return;
  const label = state.streamingMessage.querySelector(".working-label");
  if (label) {
    label.textContent = "Complete";
    label.className = "";
  }
  state.streamingMessage = null;
}

function appendToolEvent(title, detail, kind = "success") {
  const article = ensureStreamingMessage();
  const card = document.createElement("div");
  card.className = "tool-card";
  card.innerHTML = `
    <div class="tool-card-header"><span class="${kind === "success" ? "success-dot" : "thread-state"}"></span><strong>${escapeHtml(title)}</strong></div>
    <div class="tool-row"><code>${escapeHtml(detail)}</code><span>${escapeHtml(kind)}</span></div>`;
  article.querySelector(".message-body").append(card);
  scrollMessages();
}

function appendApproval(message) {
  const article = ensureStreamingMessage();
  const params = message.params || {};
  const command = params.command || params.item?.command || params.reason || "Codex requests permission";
  const card = document.createElement("div");
  card.className = "approval-card";
  card.dataset.requestId = message.id;
  card.innerHTML = `
    <div><span class="terminal-icon">$</span><strong>Run command</strong></div>
    <code>${escapeHtml(Array.isArray(command) ? command.join(" ") : String(command))}</code>
    <p>${escapeHtml(params.reason || "This action needs your approval.")}</p>
    <div class="approval-actions">
      <button class="secondary-button" data-decision="decline">Decline</button>
      <button class="secondary-button" data-decision="always">Always allow</button>
      <button class="primary-button" data-decision="approve">Approve</button>
    </div>`;
  card.addEventListener("click", async (event) => {
    const decision = event.target.dataset.decision;
    if (!decision) return;
    const isPermissionRequest = message.method === "item/permissions/requestApproval";
    const result = isPermissionRequest
      ? {
          permissions: decision === "decline" ? {} : (params.permissions || {}),
          scope: decision === "always" ? "session" : "turn"
        }
      : decision === "decline"
        ? { decision: "decline" }
        : decision === "always"
          ? { decision: "acceptForSession" }
          : { decision: "accept" };
    await api.respond({ id: message.id, result });
    card.querySelector(".approval-actions").innerHTML = `<span>${escapeHtml(decision)}</span>`;
  });
  article.querySelector(".message-body").append(card);
  scrollMessages();
}

function normalizeThreads(result) {
  return result?.data || result?.threads || result?.items || [];
}

async function loadThreads() {
  if (!state.connected) return;
  try {
    const result = await api.listThreads();
    const threads = normalizeThreads(result);
    const nav = document.querySelector("#threadNav");
    if (!threads.length) return;
    nav.innerHTML = '<p class="section-label">Recent</p>';
    for (const thread of threads.slice(0, 20)) {
      const button = document.createElement("button");
      button.className = "thread-item";
      const updated = Number.isFinite(thread.updatedAt)
        ? new Date(thread.updatedAt * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "Saved in Codex";
      button.innerHTML = `<span></span><span><strong>${escapeHtml(thread.name || thread.preview || "Untitled thread")}</strong><small>${escapeHtml(updated)}</small></span>`;
      button.addEventListener("click", async () => {
        await api.resumeThread(thread.id);
        state.threadId = thread.id;
        document.querySelectorAll(".thread-item").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
      });
      nav.append(button);
    }
  } catch (error) {
    appendToolEvent("Could not load threads", error.message, "error");
  }
}

async function loadMemories(query = "") {
  try {
    const memories = await api.listMemories(query);
    elements.memoryCount.textContent = memories.length;
    elements.memoryResults.innerHTML = "";
    if (!memories.length) {
      elements.memoryResults.innerHTML = '<p class="empty-state">No matching memory files.</p>';
      return;
    }
    for (const memory of memories.slice(0, 30)) {
      const button = document.createElement("button");
      button.className = "memory-result";
      button.innerHTML = `<strong>${escapeHtml(memory.title)}</strong><small>${escapeHtml(memory.preview)}</small>`;
      button.title = memory.path;
      button.addEventListener("click", () => api.openPath(memory.path));
      elements.memoryResults.append(button);
    }
  } catch (error) {
    elements.memoryResults.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

async function connect() {
  setStatus({ state: "offline", message: "Connecting to Codex CLI..." });
  try {
    await api.connect(state.workspace);
    await Promise.all([loadThreads(), loadMemories()]);
  } catch (error) {
    setStatus({ state: "error", message: error.message });
  }
}

async function createThread() {
  if (!state.connected) await connect();
  if (!state.connected) return;
  try {
    const result = await api.startThread({ cwd: state.workspace });
    state.threadId = result?.thread?.id || result?.id;
    state.turnId = null;
    state.streamingMessage = null;
    elements.messages.innerHTML = "";
    elements.promptInput.focus();
    await loadThreads();
  } catch (error) {
    appendToolEvent("Could not start thread", error.message, "error");
  }
}

async function sendPrompt(text) {
  if (!text.trim()) return;
  appendUserMessage(text);
  elements.promptInput.value = "";
  elements.promptInput.style.height = "auto";

  if (!state.connected) await connect();
  if (!state.connected) return;
  if (!state.threadId) await createThread();
  if (!state.threadId) return;

  try {
    elements.interruptButton.disabled = false;
    const result = await api.startTurn({
      threadId: state.threadId,
      cwd: state.workspace,
      input: [{ type: "text", text }]
    });
    state.turnId = result?.turn?.id || result?.id;
  } catch (error) {
    appendToolEvent("Turn failed", error.message, "error");
    finishStreaming();
  }
}

function handleCodexEvent(message) {
  const method = message.method || "";
  const params = message.params || {};
  if (Object.hasOwn(message, "id") && (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    /approval/i.test(method)
  )) {
    appendApproval(message);
    return;
  }
  if (method === "item/agentMessage/delta") {
    appendDelta(params.delta || params.text || "");
  } else if (method === "turn/started") {
    state.turnId = params.turn?.id;
    elements.interruptButton.disabled = false;
  } else if (method === "turn/completed") {
    elements.interruptButton.disabled = true;
    finishStreaming();
    loadThreads();
  } else if (/command|fileChange|tool/i.test(method) && /completed|started/i.test(method)) {
    appendToolEvent(method.split("/").slice(-2).join(" "), params.command || params.path || params.item?.type || "Codex tool event");
  } else if (method === "client/stderr" && params.text) {
    console.warn(params.text);
  }
}

async function initialize() {
  if (!api) {
    setStatus({ state: "error", message: "Desktop bridge unavailable. Launch through Electron." });
    return;
  }
  const environment = await api.getEnvironment();
  state.workspace = environment.workspace;
  elements.workspacePath.textContent = state.workspace;
  elements.workspaceName.textContent = state.workspace.split(/[\\/]/).filter(Boolean).pop() || state.workspace;
  elements.platformStatus.textContent = environment.platform === "linux" ? `Linux ${environment.release}` : "Ubuntu 24.04 target";
  api.onStatus(setStatus);
  api.onEvent(handleCodexEvent);
  loadMemories();
  connect();
}

elements.workspaceButton.addEventListener("click", async () => {
  const workspace = await api.chooseWorkspace();
  if (!workspace) return;
  state.workspace = workspace;
  elements.workspacePath.textContent = workspace;
  elements.workspaceName.textContent = workspace.split(/[\\/]/).filter(Boolean).pop();
  await connect();
});

elements.newThreadButton.addEventListener("click", createThread);
elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendPrompt(elements.promptInput.value);
});
elements.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});
elements.promptInput.addEventListener("input", () => {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 160)}px`;
});
elements.interruptButton.addEventListener("click", async () => {
  if (!state.threadId || !state.turnId) return;
  await api.interruptTurn({ threadId: state.threadId, turnId: state.turnId });
});
elements.memorySearch.addEventListener("input", () => loadMemories(elements.memorySearch.value));
elements.memoryButton.addEventListener("click", () => elements.memorySearch.focus());
elements.searchButton.addEventListener("click", () => elements.memorySearch.focus());
elements.settingsButton.addEventListener("click", () => elements.settingsDialog.showModal());

async function setMemories(enabled) {
  elements.memoryToggle.checked = enabled;
  elements.dialogMemoryToggle.checked = enabled;
  await api.setMemoriesEnabled(enabled);
}
elements.memoryToggle.addEventListener("change", () => setMemories(elements.memoryToggle.checked));
elements.dialogMemoryToggle.addEventListener("change", () => setMemories(elements.dialogMemoryToggle.checked));

document.querySelector("#demoApproval")?.addEventListener("click", (event) => {
  if (!event.target.dataset.approval) return;
  document.querySelector("#demoApproval .approval-actions").innerHTML = `<span>${event.target.dataset.approval === "approve" ? "Approved" : "Allowed for this session"}</span>`;
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createThread();
  }
});

initialize();
