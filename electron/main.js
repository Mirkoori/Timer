// Palco Timer per computer: avvia il server incorporato e apre il controller.
// Gli altri dispositivi (schermo relatore, moderatore) si collegano da browser con il QR.
import { app, BrowserWindow, Menu, shell, powerSaveBlocker } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTimerServer, lanAddresses } from '../server.js';

const here = path.dirname(fileURLToPath(import.meta.url));

if (!app.requestSingleInstanceLock()) app.quit();

let handle = null;
let mainWindow = null;
let blockerId = null;

async function startServer() {
  const dataFile = path.join(app.getPath('userData'), 'rooms.json');
  // Porta stabile (3000...) così gli indirizzi dei QR non cambiano da un avvio all'altro; se occupata, la prima libera.
  for (let port = 3000; port < 3010; port++) {
    try { return await createTimerServer({ port, dataFile }); } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  return createTimerServer({ port: 0, dataFile });
}

// vero per le pagine servite da questa stessa app, anche se raggiunte con l'indirizzo di rete
function isOwnPage(target) {
  try {
    const u = new URL(target);
    return u.protocol === 'http:' && Number(u.port) === handle.port
      && ['localhost', '127.0.0.1', ...lanAddresses()].includes(u.hostname);
  } catch { return false; }
}

function openWindow(url, options = {}) {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 360, minHeight: 480,
    backgroundColor: '#0d0e10', autoHideMenuBar: true, title: 'Palco Timer',
    icon: path.join(here, '..', 'public', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    ...options,
  });
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    // pagine dell'app (schermo relatore, moderatore): nuova finestra, da portare su un altro monitor
    if (isOwnPage(target)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 720, autoHideMenuBar: true, backgroundColor: '#0d0e10', title: 'Palco Timer', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } } };
    }
    shell.openExternal(target);
    return { action: 'deny' };
  });
  return win;
}

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  try {
    handle = await startServer();
  } catch (e) {
    console.error('Server non avviato', e);
    app.quit();
    return;
  }
  blockerId = powerSaveBlocker.start('prevent-display-sleep'); // lo schermo non si spegne durante l'evento
  mainWindow = openWindow(`http://localhost:${handle.port}/`);
  mainWindow.on('closed', () => { mainWindow = null; });
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) mainWindow = openWindow(`http://localhost:${handle.port}/`); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  if (blockerId !== null) powerSaveBlocker.stop(blockerId);
  if (handle) handle.close();
});
