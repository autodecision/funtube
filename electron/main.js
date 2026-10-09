import { app, BrowserWindow, ipcMain, Menu, protocol, net, session, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore } from './store.js';
import { APP_URL, assetPath, assertSender, safeUrl } from './security.js';

process.umask(0o077);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
app.setName('Funtube');
protocol.registerSchemesAsPrivileged([{ scheme: 'funtube', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let store;
let window;
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();

async function external(url) {
  try { await shell.openExternal(safeUrl(url).href); } catch { /* unsupported links stay closed */ }
}

function openWindow() {
  window = new BrowserWindow({
    title: 'Funtube', width: 1380, height: 900, minWidth: 850, minHeight: 600, backgroundColor: '#081634',
    webPreferences: { preload: join(root, 'electron/preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false },
  });
  window.removeMenu();
  window.maximize();
  window.webContents.setWindowOpenHandler(({ url }) => { void external(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (url !== APP_URL) { event.preventDefault(); void external(url); } });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.loadURL(APP_URL);
  window.on('closed', () => { window = null; });
}

if (ownsLock) app.whenReady().then(() => {
  protocol.handle('funtube', (request) => {
    if (request.method !== 'GET') return new Response('Not found', { status: 404 });
    try { return net.fetch(pathToFileURL(assetPath(join(root, 'dist'), request.url)).href); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  store = createStore(app.getPath('userData'), join(root, 'data/channel-snapshot.json'));
  const handlers = {
    channels: () => store.channels(), feed: (ids) => store.feed(ids), settings: () => store.status(),
    'video-details': (input) => store.videoDetails(input),
    'save-keys': (keys) => store.saveKeys(keys), 'all-channels': () => store.allChannels(),
    'add-channel': (input) => store.addChannel(input), 'update-channel': (input) => store.updateChannel(input), 'remove-channel': (id) => store.removeChannel(id),
    groups: () => store.groups(), 'save-group': (input) => store.saveGroup(input), 'remove-group': (id) => store.removeGroup(id), 'add-group-preset': (name) => store.addGroupPreset(name),
  };
  for (const [name, handler] of Object.entries(handlers)) ipcMain.handle(`funtube:${name}`, (event, value) => {
    assertSender(event, window?.webContents);
    return handler(value);
  });
  Menu.setApplicationMenu(null);
  openWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) openWindow(); });
});
app.on('second-instance', () => { window?.restore(); window?.focus(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => store?.close());
