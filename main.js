const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: '路線図エディタ',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 1200, height: 760, autoHideMenuBar: true, title: '路線図エディタ' }
  }));
  win.loadFile('index.html');
}

// Ctrl+W(Cmd+W)はウィンドウではなく、開いている路線図を閉じる。
// 開いている路線図がなくなったときだけウィンドウを閉じる。
app.on('browser-window-created', (_, win) => {
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.alt || input.shift) return;
    if (!(input.control || input.meta) || input.key.toLowerCase() !== 'w') return;
    e.preventDefault();
    if (input.isAutoRepeat) return;
    win.webContents.executeJavaScript('window.__closeTab ? window.__closeTab() : false')
      .then(handled => { if (!handled && !win.isDestroyed()) win.close(); })
      .catch(() => {});
  });
});

// 同じデータ(= userData フォルダ)を2つのプロセスで同時に開くと、Chromiumのキャッシュの
// ロック競合(「Unable to move the cache / アクセスが拒否されました (0x5)」)と、
// localStorage(路線図データ)の上書き競合が起きるため、二重起動は受け付けない。
// 2つ目は既存のウィンドウを前面に出してから終了する。
// (開発時の `npm start` の二重起動、インストール版と開発版の同時起動もこれで弾けます)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
