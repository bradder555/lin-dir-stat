const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const SERVER_URL = 'http://localhost:3001';
let serverProcess;

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (res) => {
          res.destroy();
          resolve();
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('Backend server did not start in time'));
          else setTimeout(attempt, 250);
        });
    };
    attempt();
  });
}

function startServer() {
  const serverEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'index.js')
    : path.join(__dirname, '../server/index.js');
  // Runs the Electron binary itself as a plain Node process to execute the server,
  // so the app doesn't depend on a system-wide Node install.
  serverProcess = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  serverProcess.on('error', (err) => {
    console.error('Failed to start backend server:', err);
  });
}

function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    backgroundColor: '#eef0f4',
    webPreferences: {
      contextIsolation: true,
    },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  return splash;
}

async function createWindow() {
  const splash = createSplashWindow();
  startServer();
  try {
    await waitForServer(SERVER_URL);
  } catch (err) {
    // Another instance (e.g. `npm run dev`) may already be serving this port; proceed anyway.
    console.error(err.message);
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#eef0f4',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // The renderer signals 'panels-ready' once the tree, cleanup, and treemap
  // panels all have data, so the splash stays up through that fetch rather
  // than just through the initial paint. The timeout and did-fail-load
  // fallbacks keep the splash from getting stuck up if that signal never
  // arrives (e.g. the server never came up in time).
  let revealed = false;
  const revealMainWindow = () => {
    if (revealed) return;
    revealed = true;
    clearTimeout(revealTimeout);
    if (!splash.isDestroyed()) splash.destroy();
    if (!win.isDestroyed()) win.show();
  };
  const revealTimeout = setTimeout(revealMainWindow, 20000);

  ipcMain.once('panels-ready', revealMainWindow);
  win.webContents.on('did-fail-load', revealMainWindow);

  win.loadURL(SERVER_URL);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
