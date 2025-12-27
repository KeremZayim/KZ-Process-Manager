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
const { autoUpdater } = require("electron-updater"); // Yeni
const log = require("electron-log"); // Yeni

const store = new Store();
// --- TEKİL ÖRNEK KİLİDİ (SINGLE INSTANCE LOCK) ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Eğer kilit alınamadıysa (yani program zaten açıksa), bu ikinci kopyayı kapat
  app.quit();
} else {
  // İkinci bir kopya açılmaya çalışıldığında tetiklenir
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore(); // Simge durumundaysa geri getir
      if (!mainWindow.isVisible()) mainWindow.show(); // Gizliyse (Tray'deyse) göster
      mainWindow.focus(); // Pencereyi öne getir ve odaklan
    }
  });
}

let mainWindow;
let tray = null;
let isQuitting = false;
let runningProcesses = {};
let isInitialScanDone = false;

// AutoUpdater Ayarları
autoUpdater.logger = log;
autoUpdater.autoDownload = store.get("settings.autoUpdate", true);

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
  // Versiyon bilgisini frontend'e gönder
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("version-info", app.getVersion());
  });

  // Güncelleme Olay Dinleyicileri
  autoUpdater.on("update-available", (info) => {
    mainWindow.webContents.send(
      "update-status",
      `Yeni sürüm bulundu (v${info.version}). İndiriliyor...`
    );
  });

  autoUpdater.on("download-progress", (progressObj) => {
    let log_message = "İndiriliyor: %" + Math.floor(progressObj.percent);
    mainWindow.webContents.send("update-status", log_message);
  });
  autoUpdater.on("update-downloaded", (info) => {
    mainWindow.webContents.send(
      "update-status",
      "Güncelleme hazır. 5 saniye içinde kurulacak..."
    );

    // Kullanıcıyı bekletmeden veya zorlayarak kurmak için:
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 5000);
  });

  autoUpdater.on("error", (err) => {
    // Hatanın detayını frontend'e gönder
    mainWindow.webContents.send("update-status", "Hata: " + err.message);
    console.error("GÜNCELLEME DETAYLI HATA:", err);
  });

  // Güncelleme bulunamadığında "Denetleniyor" yazısında takılmaması için:
  autoUpdater.on("update-not-available", () => {
    mainWindow.webContents.send("update-status", "Uygulama güncel.");
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const lastRunVersion = store.get("lastRunVersion", "0.0.0");
    const currentVersion = app.getVersion();

    // Eğer kurulu versiyon, son çalıştırılan versiyondan büyükse (Update olduysa)
    if (currentVersion !== lastRunVersion) {
      mainWindow.webContents.send("show-whats-new", currentVersion);
      // Yeni versiyonu kaydet ki bir sonraki açılışta tekrar çıkmasın
      store.set("lastRunVersion", currentVersion);
    }
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

  // EKLENEN: Ayar açıksa güncellemeleri denetle
  if (store.get("settings.autoUpdate", true)) {
    autoUpdater.checkForUpdatesAndNotify();
  }

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
  const myPid = process.pid;
  const resultsMap = new Map();
  const savedApps = store.get("apps") || [];

  // Sistem servislerini hariç tutmak için
  const IGNORED_PATHS = ["\\windows\\system32", "svchost.exe"];

  try {
    // 1. ADIM: Netstat ile port dinleyen TÜM işlemleri çek
    // (Encoding sorunu olmaması için iconv veya chcp kullanılabilir ama basit regex iş görür)
    const netstat = await new Promise((resolve) => {
      exec("netstat -ano", { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        if (err) resolve("");
        else resolve(stdout);
      });
    });

    const lines = netstat.split(/[\r\n]+/);

    for (const line of lines) {
      const lineTrimmed = line.trim();

      // Sadece TCP bağlantıları
      if (!lineTrimmed.startsWith("TCP")) continue;

      // Port durumu kontrolü (Türkçe/İngilizce uyumlu)
      const lineUpper = lineTrimmed.toUpperCase();
      const isListening =
        lineUpper.includes("LISTENING") ||
        lineUpper.includes("DINLIYOR") ||
        lineUpper.includes("DİNLİYOR");

      if (!isListening) continue;

      // Satırı parçala
      const parts = lineTrimmed.split(/\s+/);
      // PID en sondadır
      const pid = parseInt(parts[parts.length - 1]);
      // Port bilgisi 2. sıradadır (0.0.0.0:3000)
      const localAddress = parts[1];

      if (!pid || pid === myPid) continue;

      // Portu temizle (IP kısmını at)
      const port = localAddress.includes(":")
        ? localAddress.split(":").pop()
        : "???";

      // 2. ADIM: Bu PID kimin? (WMIC ile detay sor)
      // ExecutablePath ve CommandLine istiyoruz
      const wmicOutput = await new Promise((resolve) => {
        exec(
          `wmic process where processid=${pid} get CommandLine,ExecutablePath /format:csv`,
          { maxBuffer: 2 * 1024 * 1024 },
          (err, stdout) => resolve(stdout || "")
        );
      });

      // WMIC çıktısını temizle
      const wmicLines = wmicOutput.trim().split(/[\r\n]+/);
      // Başlık satırını atla, veri satırını al
      if (wmicLines.length < 2) continue;

      // Veri satırı virgülle ayrılmıştır ama CommandLine içinde de virgül olabilir.
      // Bu yüzden sondan (ExecutablePath) başa doğru gidelim ya da basitçe string check yapalım.
      const rawData = wmicLines.slice(1).join(" "); // Bazen birden fazla satıra taşabilir
      const lowerData = rawData.toLowerCase();

      // KRİTİK KONTROL: Bu bir Node.js işlemi mi?
      // Sadece node.exe veya electron.exe ise kabul et.
      const isNode =
        lowerData.includes("node.exe") || lowerData.includes("electron.exe");

      if (!isNode) continue;

      // --- PATH VE İSİM BULMA MANTIĞI ---
      let displayPath = "Bilinmeyen Konum";
      let displayName = `Node App (Port ${port})`;

      // 1. Deneme: .js dosyası var mı?
      const jsMatch = rawData.match(
        /(?:"|')([^"']+\.(?:js|mjs|cjs))(?:"|')|([^\s"']+\.(?:js|mjs|cjs))/i
      );

      // 2. Deneme: Eğer .js yoksa, 'npm start' gibi bir şey mi?
      // Genelde CommandLine içinde çalışılan klasör yazar

      if (jsMatch) {
        displayPath = jsMatch[1] || jsMatch[2];
        displayName = path.basename(displayPath);
      } else {
        // Dosya bulunamadı ama Node çalışıyor (Örn: REPL veya Binary)
        // ExecutablePath'i kullanabiliriz veya CommandLine'ın tamamını gösteririz
        displayPath = rawData.split(",").pop() || "Yol Bulunamadi"; // Kabaca path almaya çalış

        // Eğer yol çok uzunsa veya bozuksa temizle
        if (displayPath.length > 100) displayPath = "Komut Satiri Baslatmasi";

        displayName = "Node Script/Servis";
      }

      // Sistem dosyası koruması
      if (IGNORED_PATHS.some((p) => lowerData.includes(p))) continue;

      // Kayıtlı uygulamalarda zaten bu Port var mı?
      // (Eğer varsa ghost olarak gösterme, zaten takipli)
      // Ancak kullanıcı "bulmuyor" dediği için bu kontrolü esnetelim, her şeyi göstersin.

      // Benzersiz ID (PID + Port)
      const uniqueKey = `ghost_${pid}_${port}`;

      if (!resultsMap.has(uniqueKey)) {
        resultsMap.set(uniqueKey, {
          pid: pid,
          port: port,
          path: displayPath,
          name: `🌍 Port ${port} - ${displayName}`,
          memory: `PID: ${pid}`,
        });
      }
    }
  } catch (error) {
    console.error("Ghost scan hatasi:", error);
  }

  return [...resultsMap.values()];
});

// --- YENİ AYARLAR VE GÜNCELLEME KONTROLLERİ ---
ipcMain.handle("get-settings", () => ({
  winAutoStart: app.getLoginItemSettings().openAtLogin,
  autoUpdate: store.get("settings.autoUpdate", true),
}));
// --- MEVCUT IPC HANDLERLARIN ALTINA EKLE ---

ipcMain.on("reorder-apps", (event, newAppsList) => {
  store.set("apps", newAppsList);
  // Listeyi diğer pencerelere de (varsa) güncelle
  event.sender.send("update-app-list", newAppsList);
});

ipcMain.on("set-win-autostart", (event, value) => {
  app.setLoginItemSettings({ openAtLogin: value });
});

ipcMain.on("set-auto-update", (event, value) => {
  store.set("settings.autoUpdate", value);
  autoUpdater.autoDownload = value;
});

ipcMain.on("check-for-updates", () => {
  autoUpdater.checkForUpdatesAndNotify();
});

