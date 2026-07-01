import { app, dialog, Menu, Notification, nativeImage } from 'electron';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerController, type ServerState } from './server-controller.js';
import { defaultConfig, loadConfig, type ConfigIO, type AppConfig } from './config.js';
import { resolveNodePath } from './node-resolver.js';
import { createSpawn } from './spawn-server.js';
import { iconFileFor } from './icons.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');

const SUPPORT_DIR = join(homedir(), 'Library', 'Application Support', 'MoneyForKids');
const CONFIG_PATH = join(SUPPORT_DIR, 'config.json');
const LOG_PATH = join(homedir(), 'Library', 'Logs', 'MoneyForKids', 'server.log');
// Default repo path: the checkout this app was built from — two levels up from desktop/dist.
const DEFAULT_REPO = join(__dirname, '..', '..');

function configIO(path: string): ConfigIO {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: (text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
  };
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function setDockIcon(state: ServerState): void {
  const img = nativeImage.createFromPath(join(ASSETS, iconFileFor(state)));
  if (!img.isEmpty()) app.dock?.setIcon(img);
}

app.on('window-all-closed', () => {
  // Dock-only app: never quit just because there are no windows.
});

app.whenReady().then(() => {
  const config: AppConfig = loadConfig(configIO(CONFIG_PATH), defaultConfig(DEFAULT_REPO));

  app.setLoginItemSettings({ openAtLogin: config.openAtLogin });

  const nodePath = resolveNodePath({
    configured: config.nodePath,
    homedir: homedir(),
    exists: (p) => existsSync(p),
    listDir: (p) => (existsSync(p) ? readdirSync(p) : []),
  });

  if (!nodePath) {
    setDockIcon('crashed');
    notify('Money for Kids', `Node not found. Set "nodePath" in ${CONFIG_PATH}`);
    buildDockMenu('crashed', () => {}, () => {}, config);
    return;
  }

  const controller = createServerController({
    spawn: createSpawn(config.repoPath, nodePath, LOG_PATH),
  });

  const doStart = () => controller.start();
  const doStop = () => controller.stop();

  controller.on('state', (state) => {
    setDockIcon(state);
    buildDockMenu(state, doStart, doStop, config);
  });

  controller.on('crash', ({ attempt, willRestart }) => {
    notify(
      'Money for Kids',
      willRestart
        ? `Ledger server crashed — restarting (attempt ${attempt}).`
        : `Ledger server keeps crashing — gave up after ${attempt} attempts.`,
    );
  });

  // Dock icon click: toggle with confirm-on-stop.
  app.on('activate', () => {
    const state = controller.getState();
    if (state === 'running') {
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Cancel', 'Stop'],
        defaultId: 0,
        cancelId: 0,
        message: 'Stop the ledger server?',
        detail: 'The Telegram account will go offline until you start it again.',
      });
      if (choice === 1) doStop();
    } else if (state === 'stopped' || state === 'crashed') {
      doStart();
    }
    // 'starting' -> ignore
  });

  app.on('before-quit', () => controller.stop());

  setDockIcon('stopped');
  buildDockMenu('stopped', doStart, doStop, config);

  if (config.autoStartServerOnLaunch) doStart();
});

function buildDockMenu(
  state: ServerState,
  onStart: () => void,
  onStop: () => void,
  config: AppConfig,
): void {
  const isRunning = state === 'running';
  const isBusy = state === 'starting';
  const menu = Menu.buildFromTemplate([
    { label: 'Start', enabled: !isRunning && !isBusy, click: onStart },
    { label: 'Stop', enabled: isRunning, click: onStop },
    { type: 'separator' },
    { label: 'Open log', click: () => { void import('electron').then(({ shell }) => shell.openPath(LOG_PATH)); } },
    { label: 'Open config', click: () => { void import('electron').then(({ shell }) => shell.openPath(CONFIG_PATH)); } },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: config.openAtLogin,
      click: (item) => {
        config.openAtLogin = item.checked;
        app.setLoginItemSettings({ openAtLogin: item.checked });
        configIO(CONFIG_PATH).write(JSON.stringify(config, null, 2));
      },
    },
    { type: 'separator' },
    { role: 'quit' },
  ]);
  app.dock?.setMenu(menu);
}
