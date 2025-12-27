/*
  _  __  _____   ____    _____   __  __   _____      _     __   __  ___   __  __ 
 | |/ / | ____| |  _ \  | ____| |  \/  | |__  /     / \    \ \ / / |_ _| |  \/  |
 | ' /  |  _|   | |_) | |  _|   | |\/| |   / /     / _ \    \ V /   | |   | |\/| |
 | . \  | |___  |  _ <  | |___  | |  | |  / /_    / ___ \    | |    | |   | |\/| |
 |_|\_\ |_____| |_| \_\ |_____| |_|  |_| /____|  /_/   \_\   |_|   |___| |_|  |_|
                                                                                
 ===============================================================================
 DOSYA: 1 - main.js (Backend) - FIX: UI FLICKER & STABLE STATUS
 ===============================================================================
*/

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  shell,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const { spawn, exec } = require("child_process");
const pidusage = require("pidusage");

const store = new Store();
let mainWindow;
let tray = null;
let isQuitting = false;
let runningProcesses = {};
let isInitialScanDone = false;

// --- 1. PENCERE OLUŞTURMA ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#121212",
    frame: false,
    titleBarStyle: "hidden",
    icon: path.join(__dirname, "public/images/icon.png"),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mainWindow.loadFile("public/index.html");
  mainWindow.webContents.on("did-finish-load", () => {
    if (!isInitialScanDone) setTimeout(runWatchdog, 1000);
  });
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

// --- 2. TRAY MENÜSÜ ---
function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, "public/images/icon.png")
  );
  tray = new Tray(icon);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Paneli Goster", click: () => mainWindow.show() },
      { label: "Hepsini Durdur", click: stopAllProcesses },
      { type: "separator" },
      {
        label: "Cikis",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

// --- 3. OTOMATİK BAŞLATMA ---
function runAutoStartSequence() {
  const savedApps = store.get("apps") || [];
  savedApps.forEach((app) => {
    if (app.autoStart && !runningProcesses[app.id]) {
      startNodeProcess(app.id, app.path, true);
    }
  });
}

// --- 4. WATCHDOG (KARARLI TARAMA) ---
function runWatchdog() {
  const savedAppsCheck = store.get("apps") || [];
  if (savedAppsCheck.length === 0) {
    isInitialScanDone = true;
    return;
  }

  // Sadece node.exe süreçlerini al (Windows için)
  const wmicCommand = `wmic process where "name='node.exe'" get ProcessId,CommandLine /format:csv`;

  exec(wmicCommand, { maxBuffer: 10e6 }, (err, stdout) => {
    if (!isInitialScanDone) {
      isInitialScanDone = true;
      setTimeout(runAutoStartSequence, 500);
    }

    if (err || !stdout) return;

    const lines = stdout.split("\r\n");
    const systemProcesses = [];

    lines.forEach((line) => {
      const parts = line.split(",");
      if (parts.length < 2) return;
      const pid = parseInt(parts[parts.length - 1]);
      parts.pop();
      parts.shift();
      const cmdRaw = parts.join(",").toLowerCase().trim().replace(/\//g, "\\");
      if (pid) systemProcesses.push({ pid, cmd: cmdRaw });
    });

    const now = Date.now();

    savedAppsCheck.forEach((app) => {
      const existing = runningProcesses[app.id];
      const appPathNorm = path.normalize(app.path).toLowerCase();
      const appDirName = path.basename(path.dirname(appPathNorm)).toLowerCase();
      const appFileName = path.basename(appPathNorm).toLowerCase();

      // Sistemde bu projeyle eşleşen bir süreç var mı?
      const foundInSystem = systemProcesses.find((proc) => {
        // Başka bir kart tarafından halihazırda sahiplenilmiş PID'leri atla (existing hariç)
        const isClaimedByOther = Object.entries(runningProcesses).some(
          ([id, rp]) => rp.pid === proc.pid && id !== app.id.toString()
        );
        if (isClaimedByOther) return false;

        return (
          proc.cmd.includes(appPathNorm) ||
          (proc.cmd.includes(appDirName) && proc.cmd.includes(appFileName))
        );
      });

      if (foundInSystem) {
        // --- DURUM A: SÜREÇ BULUNDU ---
        if (!existing) {
          // Yeni tespit (Dış kaynak)
          runningProcesses[app.id] = {
            pid: foundInSystem.pid,
            external: true,
            lastSeen: now,
          };
          updateUI(app.id, true);
        } else {
          // Zaten vardı, bilgilerini güncelle
          existing.pid = foundInSystem.pid;
          existing.lastSeen = now;
        }
      } else {
        // --- DURUM B: SÜREÇ SİSTEMDE GÖRÜNMEDİ ---
        if (existing) {
          // Eğer süreç yeni başlatıldıysa (ilk 10 saniye) veya
          // geçici bir tarama hatasıysa hemen kapatma (5 saniye bekle)
          const age = now - (existing.startTime || 0);
          const silenceDuration = now - (existing.lastSeen || now);

          if (age < 10000 || silenceDuration < 5000) {
            // Henüz çok yeni veya kısa süreli bir kayıp, UI'yı bozma
            return;
          }

          // Gerçekten kapandığına ikna olduk
          delete runningProcesses[app.id];
          updateUI(app.id, false);
        }
      }
    });
  });
}

function updateUI(appId, isRunning) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-status-change", {
      appId: parseInt(appId),
      isRunning,
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  setInterval(runWatchdog, 3000);

  setInterval(() => {
    const activePids = Object.values(runningProcesses)
      .map((p) => p.pid)
      .filter(Boolean);
    if (activePids.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      pidusage(activePids, (err, stats) => {
        if (!err) mainWindow.webContents.send("resource-update", stats);
      });
    }
  }, 2000);
});

function stopProcessLogic(appId) {
  const proc = runningProcesses[appId];
  if (proc) {
    if (process.platform === "win32" && proc.pid) {
      exec(`taskkill /pid ${proc.pid} /T /F`);
    } else if (proc.kill) {
      proc.kill();
    }
    delete runningProcesses[appId];
    updateUI(appId, false);
  }
}

function startNodeProcess(appId, scriptPath, isAuto = false) {
  if (runningProcesses[appId]) return;

  const child = spawn("node", [`"${scriptPath}"`], {
    cwd: path.dirname(scriptPath),
    shell: true,
    env: { ...process.env, FORCE_COLOR: "true" },
  });

  // START_TIME ve LAST_SEEN ekleyerek Watchdog'a "bu sürece 10 saniye dokunma" diyoruz
  runningProcesses[appId] = {
    pid: child.pid,
    child: child,
    external: false,
    startTime: Date.now(),
    lastSeen: Date.now(),
    kill: () => child.kill(),
  };

  updateUI(appId, true);

  child.stdout.on("data", (data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("process-log", {
        appId,
        log: data.toString(),
      });
  });

  child.stderr.on("data", (data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("process-log", {
        appId,
        log: `HATA: ${data.toString()}`,
      });
  });

  child.on("close", (code) => {
    if (runningProcesses[appId] && runningProcesses[appId].pid === child.pid) {
      delete runningProcesses[appId];
      updateUI(appId, false);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send("process-log", {
          appId,
          log: `\n--- Kapanis (Kod: ${code}) ---`,
        });
    }
  });
}

// IPC HANDLERS
ipcMain.on("minimize-window", () => mainWindow.minimize());
ipcMain.on("close-window", () => mainWindow.hide());
ipcMain.on("maximize-window", () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "JavaScript", extensions: ["js"] }],
  });
  return result.filePaths[0];
});
ipcMain.on("add-app", (event, appData) => {
  const apps = store.get("apps") || [];
  apps.push(appData);
  store.set("apps", apps);
  event.sender.send("update-app-list", apps);
});
ipcMain.handle("get-apps", () => store.get("apps") || []);
ipcMain.handle(
  "get-process-pid",
  (event, appId) => runningProcesses[appId]?.pid
);
ipcMain.handle(
  "get-process-status",
  (event, appId) => !!runningProcesses[appId]
);
ipcMain.on("start-process", (event, appInfo) =>
  startNodeProcess(appInfo.id, appInfo.path)
);
ipcMain.on("stop-process", (event, appId) => stopProcessLogic(appId));
ipcMain.on("edit-app", (event, updatedApp) => {
  let apps = store.get("apps") || [];
  const index = apps.findIndex((app) => app.id === updatedApp.id);
  if (index !== -1) {
    apps[index] = updatedApp;
    store.set("apps", apps);
    event.sender.send("update-app-list", apps);
  }
});
ipcMain.on("update-auto-start", (event, { appId, enabled }) => {
  const apps = store.get("apps") || [];
  const index = apps.findIndex((app) => app.id === appId);
  if (index !== -1) {
    apps[index].autoStart = enabled;
    store.set("apps", apps);
    event.sender.send("update-app-list", apps);
  }
});
ipcMain.on("delete-app", (event, appId) => {
  let apps = store.get("apps") || [];
  const newApps = apps.filter((app) => app.id !== appId);
  store.set("apps", newApps);
  event.sender.send("update-app-list", newApps);
});
ipcMain.handle("select-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Görseller", extensions: ["png", "jpg", "jpeg", "ico", "svg"] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});
function stopAllProcesses() {
  Object.keys(runningProcesses).forEach((id) => stopProcessLogic(id));
}
ipcMain.handle("scan-ghost-processes", async () => {
  // Ghost scan fonksiyonu ihtiyaç olursa eklenebilir
  return [];
});
