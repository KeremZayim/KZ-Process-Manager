/*
  _  __  _____   ____    _____   __  __   _____      _     __   __  ___   __  __ 
 | |/ / | ____| |  _ \  | ____| |  \/  | |__  /     / \    \ \ / / |_ _| |  \/  |
 | ' /  |  _|   | |_) | |  _|   | |\/| |   / /     / _ \    \ V /   | |  | |\/| |
 | . \  | |___  |  _ <  | |___  | |  | |  / /_    / ___ \    | |    | |  | |  | |
 |_|\_\ |_____| |_| \_\ |_____| |_|  |_| /____|  /_/   \_\   |_|   |___| |_|  |_|
                                                                                 
 ===============================================================================
 DOSYA: 1 - main.js (Backend) - FIX: AGGRESSIVE DETECTION
 ===============================================================================
*/

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell } = require("electron");
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("public/index.html");

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  // Pencere yüklendiğinde taramayı başlat
  mainWindow.webContents.on('did-finish-load', () => {
      console.log(">> Pencere hazir. Taramaya baslaniyor...");
      setTimeout(runWatchdog, 1000);
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
  const iconPath = path.join(__dirname, "public/images/icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip("Node Launcher");
  const contextMenu = Menu.buildFromTemplate([
    { label: "Paneli Goster", click: () => mainWindow.show() },
    { label: "Hepsini Durdur", click: stopAllProcesses },
    { type: "separator" },
    { label: "Cikis", click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => mainWindow.show());
}

// --- 3. OTOMATİK BAŞLATMA ---
function runAutoStartSequence() {
    console.log(">> Tarama bitti. Otomatik baslatma kontrol ediliyor...");
    const savedApps = store.get("apps") || [];
    
    savedApps.forEach((app) => {
        if (app.autoStart) {
            // Sadece gerçekten kapalıysa başlat
            if (!runningProcesses[app.id]) {
                console.log(`>> Otomatik Baslatiliyor: ${app.name}`);
                setTimeout(() => {
                    startNodeProcess(app.id, app.path, true);
                }, 1000);
            } else {
                console.log(`>> Zaten calisiyor: ${app.name}, atlandi.`);
            }
        }
    });
}

// --- 4. WATCHDOG (AGRESIF TARAMA) ---
function runWatchdog() {
    const savedAppsCheck = store.get("apps") || [];
    
    // Uygulama yoksa bile ilk tarama bayrağını kaldır
    if (savedAppsCheck.length === 0) {
        if (!isInitialScanDone) { isInitialScanDone = true; }
        return;
    }

    const wmicCommand = `wmic process where "name='node.exe' or name='electron.exe'" get ProcessId,CommandLine /format:csv`;

    exec(wmicCommand, { maxBuffer: 5e6 }, (err, stdout) => {
        // İlk tarama bitişi
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
            // CSV formatında son eleman PID, ondan önceki Command Line'dır ama virgül içerebilir.
            // Bu yüzden PID'yi sondan alıp kalanı birleştiriyoruz.
            const pid = parseInt(parts[parts.length - 1]);
            
            // Komut satırını düzgün al (Virgüllü pathler için)
            parts.pop(); // PID'yi at
            parts.shift(); // Baştaki boş node'u at (Node,Caption,...)
            const cmdRaw = parts.join(",").toLowerCase().trim();

            if (!pid || !cmdRaw.includes("node")) return;
            systemProcesses.push({ pid, cmd: cmdRaw });
        });

        // Debug için konsola bas (Neler bulundu?)
        // console.log(">> Sistemdeki Node Islemleri:", systemProcesses.length);

        // PID Sahiplenme (Çakışma Önleyici)
        const claimedPids = new Set();
        Object.values(runningProcesses).forEach(proc => {
            if(proc && proc.pid) claimedPids.add(proc.pid);
        });

        savedAppsCheck.forEach((app) => {
            // Zaten bizde kayıtlıysa, process yaşıyor mu kontrol et
            if (runningProcesses[app.id]) {
                const isAlive = systemProcesses.some(p => p.pid === runningProcesses[app.id].pid);
                if(!isAlive) {
                     console.log(`>> Dis kaynak kapandi: ${app.name}`);
                     delete runningProcesses[app.id];
                     if (mainWindow && !mainWindow.isDestroyed()) {
                         mainWindow.webContents.send("app-status-change", { appId: app.id, isRunning: false });
                     }
                }
                return; 
            }

            const appPathNormalized = path.normalize(app.path).toLowerCase();
            const appFileName = path.basename(appPathNormalized); 
            const appDirName = path.basename(path.dirname(appPathNormalized));

            // --- AGRESIF EŞLEŞTİRME ---
            const foundProc = systemProcesses.find((proc) => {
                if (claimedPids.has(proc.pid)) return false; // Kapılmış PID
                
                // 1. Tam Yol (Mükemmel Eşleşme)
                if (proc.cmd.includes(appPathNormalized)) return true;
                
                // 2. Klasör + Dosya (Güçlü Eşleşme)
                if (proc.cmd.includes(appDirName) && proc.cmd.includes(appFileName)) return true;
                
                // 3. Sadece Dosya Adı (Esnek Eşleşme)
                // "server.js" komut satırında geçiyor mu?
                // ÖNEMLİ: Eğer dosya adınız çok kısaysa (örn: "a.js") riskli olabilir ama "server.js" için idealdir.
                if (proc.cmd.includes(appFileName)) return true;
                
                return false;
            });

            if (foundProc) {
                claimedPids.add(foundProc.pid); // PID'yi kap
                console.log(`>> BULUNDU (PID ${foundProc.pid}) -> ${app.name}`);
                
                runningProcesses[app.id] = {
                    pid: foundProc.pid,
                    external: true,
                    kill: () => {
                        if (process.platform === "win32") exec(`taskkill /pid ${foundProc.pid} /T /F`);
                        else process.kill(foundProc.pid);
                    },
                };
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send("app-status-change", { appId: app.id, isRunning: true });
                }
            }
        });
    });
}

// UYGULAMA BAŞLANGICI
app.whenReady().then(() => {
  createWindow();
  createTray();
  
  // Periyodik tarama
  setInterval(runWatchdog, 3000);

  // CPU/RAM Takibi
  setInterval(() => {
    const activePids = [];
    Object.keys(runningProcesses).forEach((id) => {
      const proc = runningProcesses[id];
      if (proc && proc.pid) {
        try {
          process.kill(proc.pid, 0); 
          activePids.push(proc.pid);
        } catch (e) {
          delete runningProcesses[id];
          if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send("app-status-change", { appId: parseInt(id), isRunning: false });
        }
      }
    });

    if (activePids.length > 0) {
      pidusage(activePids, (err, stats) => {
        if (!err && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("resource-update", stats);
        }
      });
    }
  }, 2000);
});

// 5. PROCESS KONTROLLERİ
function stopAllProcesses() {
  Object.keys(runningProcesses).forEach((id) => {
    if (runningProcesses[id]) {
      if (process.platform === "win32" && runningProcesses[id].pid) {
        exec(`taskkill /pid ${runningProcesses[id].pid} /T /F`);
      } else {
        runningProcesses[id].kill();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("app-status-change", { appId: parseInt(id), isRunning: false });
        mainWindow.webContents.send("process-log", { appId: parseInt(id), log: "\n🔴 --- Tümü Durduruldu ---\n" });
      }
    }
  });
  runningProcesses = {};
}

function startNodeProcess(appId, scriptPath, isAuto = false) {
  if (runningProcesses[appId]) return;
  if (isAuto) console.log(`>> OTO-BASLATMA: ${path.basename(scriptPath)}`);

  const child = spawn("cmd.exe", ["/c", "chcp 65001 > nul && node", `"${path.basename(scriptPath)}"`], {
      cwd: path.dirname(scriptPath),
      shell: true,
      env: { ...process.env, FORCE_COLOR: "true", LANG: "tr_TR.UTF-8" },
  });

  runningProcesses[appId] = child;
  
  if (mainWindow) mainWindow.webContents.send("process-started", { appId: appId, pid: child.pid });
  if (mainWindow) mainWindow.webContents.send("app-status-change", { appId: appId, isRunning: true });

  child.stdout.on("data", (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("process-log", { appId: appId, log: data.toString() });
  });
  child.stderr.on("data", (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("process-log", { appId: appId, log: `HATA: ${data.toString()}` });
  });
  child.on("close", (code) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("process-log", { appId: appId, log: `\n--- Kapanis (Kod: ${code}) ---` });
    if (runningProcesses[appId] === child) {
        delete runningProcesses[appId];
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send("app-status-change", { appId: appId, isRunning: false });
    }
  });
}

// IPC HANDLERS
ipcMain.on("minimize-window", () => mainWindow.minimize());
ipcMain.on("close-window", () => mainWindow.hide());
ipcMain.on("maximize-window", () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});
ipcMain.handle("select-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "JavaScript", extensions: ["js"] }] });
  return result.filePaths[0];
});
ipcMain.on("add-app", (event, appData) => {
  const apps = store.get("apps") || [];
  apps.push(appData);
  store.set("apps", apps);
  event.sender.send("update-app-list", apps);
});
ipcMain.handle("get-apps", () => store.get("apps") || []);
ipcMain.handle("get-process-pid", (event, appId) => runningProcesses[appId] ? runningProcesses[appId].pid : null);
ipcMain.handle("get-process-status", (event, appId) => !!runningProcesses[appId]);
ipcMain.on("start-process", (event, appInfo) => startNodeProcess(appInfo.id, appInfo.path));
ipcMain.on("stop-process", (event, appId) => {
  if (runningProcesses[appId]) {
    const pid = runningProcesses[appId].pid;
    if (process.platform === "win32") exec(`taskkill /pid ${pid} /T /F`);
    else runningProcesses[appId].kill();
    delete runningProcesses[appId];
    event.sender.send("process-log", { appId: appId, log: "\n🔴 --- Durduruldu ---\n" });
    event.sender.send("app-status-change", { appId: appId, isRunning: false });
  }
});
ipcMain.handle("select-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "Görseller", extensions: ["png", "jpg", "jpeg", "ico", "svg"] }] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.on("edit-app", (event, updatedApp) => {
  let apps = store.get("apps") || [];
  const index = apps.findIndex((app) => app.id === updatedApp.id);
  if (index !== -1) { apps[index] = updatedApp; store.set("apps", apps); event.sender.send("update-app-list", apps); }
});
ipcMain.on("update-auto-start", (event, { appId, enabled }) => {
  const apps = store.get("apps") || [];
  const index = apps.findIndex((app) => app.id === appId);
  if (index !== -1) { apps[index].autoStart = enabled; store.set("apps", apps); event.sender.send("update-app-list", apps); }
});
ipcMain.on("delete-app", (event, appId) => {
  let apps = store.get("apps") || [];
  const newApps = apps.filter((app) => app.id !== appId);
  store.set("apps", newApps);
  event.sender.send("update-app-list", newApps);
});
ipcMain.handle("scan-ghost-processes", async () => {
  const myPid = process.pid;
  const resultsMap = new Map();
  const savedApps = store.get("apps") || [];
  const systemPaths = ["\\appdata\\", "\\program files", "\\windows\\", "\\discord\\", "\\electron\\", "\\chrome\\", "\\microsoft\\", "\\npm\\"];
  const netstat = await new Promise((resolve) => exec("netstat -ano", { maxBuffer: 5e6 }, (_, stdout) => resolve(stdout)));
  const lines = netstat.split("\n");
  for (const line of lines) {
    if (!line.includes("LISTENING") || !line.trim().startsWith("TCP")) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parseInt(parts[parts.length - 1]);
    const port = parts[1].split(":").pop();
    if (!pid || pid === myPid) continue;
    const cmd = await new Promise((resolve) => exec(`wmic process where processid=${pid} get CommandLine`, { maxBuffer: 2e6 }, (_, stdout) => resolve(stdout || "")));
    if (!cmd.toLowerCase().includes("node")) continue;
    const jsMatch = cmd.match(/([^"'\s]+\.(js|mjs|cjs))/i);
    let displayPath = "Bilinmeyen", normPath = "";
    if (jsMatch) {
      displayPath = jsMatch[0];
      normPath = path.normalize(displayPath).toLowerCase();
      if (normPath.includes("node_modules") || systemPaths.some((p) => normPath.includes(p))) continue;
      const fileName = path.basename(normPath);
      if (savedApps.some((app) => path.basename(app.path).toLowerCase() === fileName)) continue;
    } else { displayPath = "Komut Satırı İşlemi"; normPath = "unknown_" + pid; }
    if (!resultsMap.has(normPath)) resultsMap.set(normPath, { pid, port, path: displayPath, name: `🌍 Port ${port} (PID: ${pid})`, memory: `PID ${pid}` });
  }
  return [...resultsMap.values()];
});