const { app, BrowserWindow, dialog } = require("electron");
const { fork, spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let mainWindow = null;
let serverProcess = null;

app.setName("Conserva SES Score Dashboard");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Could not allocate a local port."));
      });
    });
  });
}

function waitForServer(url, timeoutMs = 60_000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, 500);
      });
      request.setTimeout(2_000, () => request.destroy());
    };

    check();
  });
}

function serverEnvironment(port) {
  return {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    AUTH_MODE: "desktop",
    ELECTRON_APP: "1",
    SES_DASHBOARD_DATA_DIR: path.join(app.getPath("userData"), "data"),
  };
}

function startPackagedServer(port) {
  const appPath = app.getAppPath();
  const serverPath = path.join(appPath, ".next", "standalone", "server.js");
  serverProcess = fork(serverPath, [], {
    cwd: path.join(appPath, ".next", "standalone"),
    env: serverEnvironment(port),
    stdio: "pipe",
  });
}

function startDevServer(port) {
  const projectDir = path.join(__dirname, "..");
  serverProcess = spawn("npm", ["run", "dev", "--", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: projectDir,
    env: {
      ...serverEnvironment(port),
      NODE_ENV: "development",
    },
    shell: true,
    stdio: "pipe",
  });
}

async function startServer(port) {
  if (app.isPackaged) startPackagedServer(port);
  else startDevServer(port);

  serverProcess.stdout?.on("data", (chunk) => console.log(`[next] ${chunk}`));
  serverProcess.stderr?.on("data", (chunk) => console.error(`[next] ${chunk}`));
  serverProcess.on("exit", (code, signal) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.error(`Next server exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    }
  });
}

async function createWindow() {
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;

  await startServer(port);
  await waitForServer(url);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    title: "Conserva SES Score Dashboard",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(`${url}/dashboard`);
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    dialog.showErrorBox("Dashboard failed to start", error instanceof Error ? error.message : String(error));
    app.quit();
  });
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopServer);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      dialog.showErrorBox("Dashboard failed to start", error instanceof Error ? error.message : String(error));
    });
  }
});
