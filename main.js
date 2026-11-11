'use strict';

/**
 * CHICAGO BULLS APP (CBA) - proceso principal de Electron.
 *
 * Cliente de escritorio real para HaxBall (https://www.haxball.com/play):
 *  - Carga el cliente oficial de HaxBall y le inyecta, desde el preload
 *    (mundo aislado), la identidad Chicago Bulls y las herramientas CBA.
 *  - No modifica la logica del juego: solo CSS + overlays propios.
 *  - Persistencia de preferencias en userData (JSON).
 *  - Seguridad: contextIsolation activo, nodeIntegration desactivado para la
 *    pagina y navegacion bloqueada fuera de haxball.com.
 */

require('./src/main/early-flags.js');

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createStore } = require('./src/main/store.js');

const START_URL = 'https://www.haxball.com/play';
const HAXBALL_ORIGIN = /^https?:\/\/([a-z0-9-]+\.)*haxball\.com(\/|$)/i;
const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
const APP_ICON_PNG = path.join(__dirname, 'assets', 'icon.png');
const LOGO_PNG = path.join(__dirname, 'img', 'logochicago.png');

const store = createStore(app.getPath('userData'));
const windows = new Set();
let logoDataUrlCache = null;

/* ------------------------------------------------------------------ logs -- */

function appendLog(line) {
    const msg = '[' + new Date().toISOString() + '] ' + String(line) + '\n';
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'startup.log'), msg, 'utf8'); } catch (e) {}
    try { process.stdout.write('[CBA] ' + msg); } catch (e2) {}
}

function writeSafeGraphicsFlag(write) {
    try {
        const flag = path.join(app.getPath('userData'), 'cba-safe-graphics.flag');
        if (write) fs.writeFileSync(flag, 'auto\n', 'utf8');
        else if (fs.existsSync(flag)) fs.unlinkSync(flag);
    } catch (e) {}
}

/* -------------------------------------------------------------- ventana -- */

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: '#0b0b0d',
        show: false,
        autoHideMenuBar: true,
        icon: fs.existsSync(APP_ICON) ? APP_ICON : (fs.existsSync(APP_ICON_PNG) ? APP_ICON_PNG : undefined),
        title: 'Chicago Bulls APP',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            sandbox: false,
            webSecurity: true,
            spellcheck: false,
            backgroundThrottling: false
        }
    });

    windows.add(win);
    win.on('closed', function () { windows.delete(win); });

    // Crash del render: perfil conservador + recarga (no dejar al usuario en negro).
    win.webContents.on('render-process-gone', function (event, details) {
        appendLog('render-process-gone: ' + JSON.stringify(details || {}));
        if (details && (details.reason === 'crashed' || details.reason === 'oom')) {
            writeSafeGraphicsFlag(true);
        }
        if (!win.isDestroyed()) {
            setTimeout(function () {
                try { if (!win.isDestroyed()) win.webContents.reload(); } catch (eReload) {}
            }, 800);
        }
    });

    win.webContents.on('did-fail-load', function (event, errorCode, errorDescription, validatedURL, isMainFrame) {
        if (!isMainFrame) return;
        appendLog('did-fail-load ' + errorCode + ' ' + errorDescription + ' ' + validatedURL);
        try {
            win.webContents.send('cba:net-error', { code: errorCode, description: errorDescription, url: validatedURL });
        } catch (eSend) {}
    });

    // El cliente no navega fuera de HaxBall: los enlaces externos van al navegador.
    win.webContents.setWindowOpenHandler(function (details) {
        const url = String(details.url || '');
        if (/^https?:/i.test(url)) {
            try { shell.openExternal(url); } catch (eExt) {}
        }
        return { action: 'deny' };
    });

    win.webContents.on('will-navigate', function (event, url) {
        if (!HAXBALL_ORIGIN.test(String(url || ''))) {
            event.preventDefault();
            if (/^https?:/i.test(String(url || ''))) {
                try { shell.openExternal(String(url)); } catch (eExt) {}
            }
        }
    });

    win.once('ready-to-show', function () { win.show(); });
    win.loadURL(START_URL).catch(function (err) {
        appendLog('loadURL failed: ' + (err && err.message ? err.message : String(err)));
        try { win.show(); } catch (eShow) {}
        try { win.webContents.send('cba:net-error', { code: -1, description: String(err), url: START_URL }); } catch (e) {}
    });
    return win;
}

/* ------------------------------------------------------------------ IPC -- */

function getLogoDataUrl() {
    if (logoDataUrlCache) return logoDataUrlCache;
    try {
        const buf = fs.readFileSync(LOGO_PNG);
        logoDataUrlCache = 'data:image/png;base64,' + buf.toString('base64');
    } catch (eLogo) {
        logoDataUrlCache = '';
    }
    return logoDataUrlCache;
}

function broadcast(settings, exceptId) {
    for (const win of windows) {
        if (win.isDestroyed()) continue;
        try {
            if (exceptId != null && win.webContents.id === exceptId) continue;
            win.webContents.send('cba:settings-changed', settings);
        } catch (eSend) {}
    }
}

store.onChange(function (settings, exceptId) { broadcast(settings, exceptId); });

ipcMain.handle('cba:settings-get', function () { return store.get(); });

ipcMain.handle('cba:settings-patch', function (event, patch) {
    const next = store.patch(patch);
    store.notify(event.sender.id);
    return next;
});

ipcMain.handle('cba:settings-reset', function () {
    const next = store.reset();
    store.notify();
    return next;
});

ipcMain.handle('cba:logo', function () { return getLogoDataUrl(); });

ipcMain.handle('cba:app-info', function () {
    return {
        name: 'Chicago Bulls APP (CBA)',
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform
    };
});

ipcMain.handle('cba:new-window', function () {
    const win = createWindow();
    return { ok: true };
});

ipcMain.handle('cba:open-external', function (event, url) {
    const target = String(url || '');
    if (/^https?:\/\//i.test(target)) {
        try { shell.openExternal(target); return { ok: true }; } catch (e) { return { ok: false }; }
    }
    return { ok: false };
});

ipcMain.handle('cba:reload-page', function (event) {
    try {
        event.sender.reload();
        return { ok: true };
    } catch (e) {
        return { ok: false };
    }
});

/* --------------------------------------------------------------- arranque */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', function () {
        for (const win of windows) {
            if (win.isDestroyed()) continue;
            try {
                if (win.isMinimized()) win.restore();
                win.focus();
            } catch (eFocus) {}
        }
    });

    app.whenReady().then(function () {
        appendLog('=== Chicago Bulls APP (CBA) inicio ===');
        appendLog('versions=' + JSON.stringify(process.versions));
        try { appendLog('userData=' + app.getPath('userData')); } catch (e) {}

        Menu.setApplicationMenu(null);
        createWindow();

        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', function () {
        store.flush();
        if (process.platform !== 'darwin') app.quit();
    });

    app.on('before-quit', function () { store.flush(); });

    process.on('uncaughtException', function (err) {
        appendLog('uncaughtException: ' + (err && err.stack ? err.stack : String(err)));
    });
    process.on('unhandledRejection', function (reason) {
        appendLog('unhandledRejection: ' + (reason && reason.stack ? reason.stack : String(reason)));
    });
}
