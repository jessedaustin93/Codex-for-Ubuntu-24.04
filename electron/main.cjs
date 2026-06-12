const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

let mainWindow;
let codexProcess;
let lineReader;
let requestId = 1;
let activeWorkspace = process.cwd();
const pending = new Map();

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#111315",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#15181b",
      symbolColor: "#c7cbcf",
      height: 42
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));
  if (process.argv.includes("--dev")) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function writeMessage(message) {
  if (!codexProcess?.stdin?.writable) throw new Error("Codex app-server is not connected.");
  codexProcess.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}, timeoutMs = 30000) {
  const id = requestId++;
  writeMessage({ method, id, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

function notify(method, params = {}) {
  writeMessage({ method, params });
}

function settleResponse(message) {
  const waiter = pending.get(message.id);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message || "Codex request failed"));
  else waiter.resolve(message.result);
  return true;
}

function stopCodex() {
  lineReader?.close();
  lineReader = undefined;
  if (codexProcess && !codexProcess.killed) codexProcess.kill();
  codexProcess = undefined;
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Codex app-server disconnected."));
  }
  pending.clear();
}

async function startCodex(workspace) {
  stopCodex();
  activeWorkspace = workspace || activeWorkspace;

  return new Promise((resolve, reject) => {
    let initialized = false;
    let stderr = "";
    codexProcess = spawn("codex", ["app-server", "--listen", "stdio://"], {
      cwd: activeWorkspace,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    codexProcess.once("error", (error) => {
      sendToRenderer("codex:status", { state: "error", message: error.message });
      reject(new Error("Could not launch `codex app-server`. Install the Codex CLI and run `codex login`."));
    });

    codexProcess.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      sendToRenderer("codex:event", { method: "client/stderr", params: { text: chunk.toString() } });
    });

    codexProcess.once("exit", (code) => {
      sendToRenderer("codex:status", {
        state: "offline",
        message: code === 0 ? "Codex stopped." : stderr.trim() || `Codex exited with code ${code}.`
      });
      stopCodex();
    });

    lineReader = readline.createInterface({ input: codexProcess.stdout });
    lineReader.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (Object.hasOwn(message, "id") && settleResponse(message)) return;
        sendToRenderer("codex:event", message);
      } catch {
        sendToRenderer("codex:event", { method: "client/output", params: { text: line } });
      }
    });

    request("initialize", {
      clientInfo: {
        name: "codex_linux",
        title: "Codex Linux",
        version: app.getVersion()
      },
      capabilities: { experimentalApi: true }
    }).then((result) => {
      notify("initialized");
      initialized = true;
      sendToRenderer("codex:status", {
        state: "connected",
        message: "Connected to Codex CLI",
        platform: result?.platformOs || process.platform
      });
      resolve(result);
    }).catch((error) => {
      if (!initialized) reject(error);
    });
  });
}

function memoryRoot() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "memories");
}

function walkMarkdown(root, result = []) {
  if (!fs.existsSync(root)) return result;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) walkMarkdown(fullPath, result);
    else if (entry.isFile() && /\.(md|jsonl|txt)$/i.test(entry.name)) result.push(fullPath);
  }
  return result;
}

function readMemories(query = "") {
  const root = memoryRoot();
  const needle = query.trim().toLowerCase();
  return walkMarkdown(root).flatMap((filePath) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      if (needle && !content.toLowerCase().includes(needle) && !filePath.toLowerCase().includes(needle)) return [];
      const lines = content.split(/\r?\n/).filter(Boolean);
      const matchingLine = needle ? lines.find((line) => line.toLowerCase().includes(needle)) : lines[0];
      return [{
        path: filePath,
        relativePath: path.relative(root, filePath),
        title: lines.find((line) => /^#{1,3}\s/.test(line))?.replace(/^#{1,3}\s+/, "") || path.basename(filePath),
        preview: (matchingLine || "Memory file").replace(/^[-#*\s]+/, "").slice(0, 180),
        modifiedAt: fs.statSync(filePath).mtimeMs
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 100);
}

function updateMemoryFeature(enabled) {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  fs.mkdirSync(codexHome, { recursive: true });
  let config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const featureBlock = /(\[features\][\s\S]*?)(?=\n\[|$)/m;
  if (featureBlock.test(config)) {
    config = config.replace(featureBlock, (block) => {
      if (/^memories\s*=/m.test(block)) return block.replace(/^memories\s*=.*$/m, `memories = ${enabled}`);
      return `${block.trimEnd()}\nmemories = ${enabled}\n`;
    });
  } else {
    config = `${config.trimEnd()}${config.trim() ? "\n\n" : ""}[features]\nmemories = ${enabled}\n`;
  }
  fs.writeFileSync(configPath, config, "utf8");
  return { enabled, configPath };
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("app:get-environment", () => ({
    platform: process.platform,
    release: os.release(),
    home: os.homedir(),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    workspace: activeWorkspace
  }));
  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a workspace",
      defaultPath: activeWorkspace,
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("codex:connect", (_event, workspace) => startCodex(workspace));
  ipcMain.handle("codex:disconnect", () => stopCodex());
  ipcMain.handle("codex:start-thread", (_event, options = {}) =>
    request("thread/start", { cwd: options.cwd || activeWorkspace, ...options })
  );
  ipcMain.handle("codex:list-threads", () => request("thread/list", { limit: 50 }));
  ipcMain.handle("codex:resume-thread", (_event, threadId) => request("thread/resume", { threadId }));
  ipcMain.handle("codex:start-turn", (_event, payload) => request("turn/start", payload, 120000));
  ipcMain.handle("codex:interrupt-turn", (_event, payload) => request("turn/interrupt", payload));
  ipcMain.handle("codex:respond", (_event, payload) => {
    writeMessage({ id: payload.id, result: payload.result });
    return { sent: true };
  });
  ipcMain.handle("memory:list", (_event, query) => readMemories(query));
  ipcMain.handle("memory:set-enabled", (_event, enabled) => updateMemoryFeature(Boolean(enabled)));
  ipcMain.handle("shell:open-path", (_event, targetPath) => shell.openPath(targetPath));
});

app.on("window-all-closed", () => {
  stopCodex();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
