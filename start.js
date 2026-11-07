#!/usr/bin/env node
/* ============================================================
   CHICAGO BULLS APP (CBA) — launcher
   Opens a dedicated Chromium window with the unpacked extension
   loaded and verifies that the real HaxBall client received the
   CBA skin. It never wraps, proxies or modifies HaxBall: the real
   client keeps running on https://www.haxball.com.
   ============================================================ */

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT_DIR = path.resolve(__dirname);
const PLAY_URL = "https://www.haxball.com/play";
const APP_ID = "CHICAGOBULLS-APP";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function resolveBrowser() {
  if (process.env.CB_BROWSER) {
    if (!fs.existsSync(process.env.CB_BROWSER)) {
      throw new Error(
        `CB_BROWSER apunta a un archivo inexistente:\n  ${process.env.CB_BROWSER}`
      );
    }
    return process.env.CB_BROWSER;
  }

  const fromPath = (name) => {
    const dirs = (process.env.PATH || "").split(path.delimiter);
    const exts =
      process.platform === "win32"
        ? (process.env.PATHEXT || ".EXE").split(";")
        : [""];
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext.toLowerCase());
        if (fs.existsSync(candidate)) return candidate;
        const upper = path.join(dir, name + ext.toUpperCase());
        if (fs.existsSync(upper)) return upper;
      }
    }
    return null;
  };

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    return (
      firstExisting([
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        path.join(local, "Google/Chrome/Application/chrome.exe"),
      ]) ||
      fromPath("msedge") ||
      fromPath("chrome")
    );
  }

  if (process.platform === "darwin") {
    return firstExisting([
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]);
  }

  return (
    firstExisting([
      "/usr/bin/microsoft-edge",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ]) ||
    fromPath("microsoft-edge") ||
    fromPath("google-chrome") ||
    fromPath("chromium")
  );
}

function resolveProfileDir() {
  if (process.env.CB_PROFILE_DIR) {
    const custom = path.resolve(process.env.CB_PROFILE_DIR);
    fs.mkdirSync(custom, { recursive: true });
    return custom;
  }

  const base =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");

  const dir = path.join(base, APP_ID, "profile");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ------------------------------------------------------------
   Profile recovery
   Edge/Chrome can permanently mark an unpacked extension with
   DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION (reason 16777216) when
   "developer mode" is off in a profile. Once that happens the
   content scripts never run, even with --load-extension. A clean
   profile with the same flags works, so we detect the poisoned
   entry before launching, keep a backup and rotate to a clean
   profile while preserving chrome.storage.local data.
   ------------------------------------------------------------ */

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function samePath(a, b) {
  if (!a || !b) return false;
  const normalize = (value) =>
    path.resolve(value).replace(/[\\/]+/g, path.sep).toLowerCase();
  return normalize(a) === normalize(b);
}

function readExtensionEntries(profileDir) {
  const files = [
    path.join(profileDir, "Default", "Secure Preferences"),
    path.join(profileDir, "Default", "Preferences"),
  ];
  const entries = [];

  for (const file of files) {
    const data = readJsonFile(file);
    const settings = data && data.extensions && data.extensions.settings;
    if (!settings) continue;
    for (const [id, entry] of Object.entries(settings)) {
      if (!entry || typeof entry !== "object") continue;
      entries.push({ id, entry, file });
    }
  }

  return entries;
}

function findBlockedExtension(profileDir) {
  return readExtensionEntries(profileDir).find(({ entry }) => {
    if (!samePath(entry.path, PROJECT_DIR)) return false;
    return Array.isArray(entry.disable_reasons) && entry.disable_reasons.length > 0;
  });
}

function copyExtensionStorage(fromProfile, toProfile) {
  const from = path.join(fromProfile, "Default", "Local Extension Settings");
  const to = path.join(toProfile, "Default", "Local Extension Settings");
  if (!fs.existsSync(from)) return false;

  try {
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

function rotateProfile(profileDir, reason) {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const backup = `${profileDir}.backup-${stamp}`;

  fs.mkdirSync(path.dirname(profileDir), { recursive: true });
  if (fs.existsSync(profileDir)) {
    fs.renameSync(profileDir, backup);
  }
  fs.mkdirSync(profileDir, { recursive: true });

  const migrated = copyExtensionStorage(backup, profileDir);
  return { backup, migrated, reason };
}

function prepareProfile(profileDir) {
  const blocked = findBlockedExtension(profileDir);
  const forceReset = process.env.CB_PROFILE_RESET === "1";

  if (!blocked && !forceReset) return null;

  const reason = blocked
    ? `la extensión está deshabilitada por el navegador (reason ${blocked.entry.disable_reasons.join(",")})`
    : "reinicio de perfil solicitado con CB_PROFILE_RESET=1";

  try {
    return rotateProfile(profileDir, reason);
  } catch (error) {
    return { error: error.message, reason };
  }
}

function waitForDevToolsPort(profileDir, timeoutMs) {
  const portFile = path.join(profileDir, "DevToolsActivePort");
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (fs.existsSync(portFile)) {
          const raw = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
          const port = Number(raw[0]);
          if (Number.isFinite(port) && port > 0) {
            resolve({ port, path: raw[1] || "" });
            return;
          }
        }
      } catch (_) {
        /* the browser may be writing the file */
      }

      if (Date.now() - started > timeoutMs) {
        reject(new Error("El navegador no expuso el puerto de depuración."));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

/* Minimal Chrome DevTools Protocol client using Node's built-in
   WebSocket (Node 22+). The launcher still works without it by
   falling back to the legacy --load-extension flags. */
function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      reject(error);
      return;
    }

    let nextId = 0;
    const pending = new Map();

    const failAll = (error) => {
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    };

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch (_) {
        return;
      }
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        entry.reject(
          new Error(message.error.message || JSON.stringify(message.error))
        );
      } else {
        entry.resolve(message.result || {});
      }
    });

    ws.addEventListener("error", () => {
      failAll(new Error("Error de conexión con el protocolo del navegador."));
    });

    ws.addEventListener("close", () => {
      failAll(new Error("El navegador cerró la conexión de depuración."));
    });

    ws.addEventListener("open", () => {
      resolve({
        send(method, params, sessionId) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            const timer = setTimeout(() => {
              pending.delete(id);
              rej(new Error(`Tiempo agotado ejecutando ${method}.`));
            }, 15000);
            pending.set(id, {
              resolve(value) {
                clearTimeout(timer);
                res(value);
              },
              reject(error) {
                clearTimeout(timer);
                rej(error);
              },
            });
            const payload = { id, method, params: params || {} };
            if (sessionId) payload.sessionId = sessionId;
            ws.send(JSON.stringify(payload));
          });
        },
        close() {
          try {
            ws.close();
          } catch (_) {
            /* already closed */
          }
        },
      });
    });
  });
}

async function evaluateInPage(client, sessionId, expression) {
  const result = await client.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  return result && result.result ? result.result.value : undefined;
}

async function waitForSkin(client, sessionId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ok = await evaluateInPage(
        client,
        sessionId,
        "document.documentElement.classList.contains('cb-play') && !!document.querySelector('.cb-header-brand')"
      );
      if (ok) return true;
    } catch (_) {
      /* navigation or execution context not ready yet */
    }
    await sleep(500);
  }
  return false;
}

async function findHaxballTarget(client) {
  const { targetInfos } = await client.send("Target.getTargets");
  const pages = targetInfos.filter((target) => target.type === "page");
  return (
    pages.find((target) => /haxball\.com/i.test(target.url)) ||
    pages.find((target) => target.url === "about:blank") ||
    pages.find((target) => target.url.startsWith("edge://newtab")) ||
    null
  );
}

async function openAndVerify(browser, profileDir, options) {
  const headless = !!options.headless;
  const portFile = path.join(profileDir, "DevToolsActivePort");
  try {
    fs.rmSync(portFile, { force: true });
  } catch (_) {
    /* ignore */
  }

  const args = [
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${PROJECT_DIR}`,
    `--load-extension=${PROJECT_DIR}`,
    "--enable-unsafe-extension-debugging",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1400,900",
  ];

  if (headless) args.push("--headless=new");

  if (process.env.CB_APP_WINDOW === "0") {
    args.push(PLAY_URL);
  } else {
    args.push(`--app=${PLAY_URL}`);
  }

  const child = spawn(browser, args, {
    detached: !options.closeAfterVerify,
    stdio: "ignore",
  });

  child.on("error", (error) => {
    console.error(`[CHICAGO BULLS] No se pudo iniciar el navegador: ${error.message}`);
  });

  if (!options.closeAfterVerify) child.unref();

  const result = {
    browser,
    profile: profileDir,
    extensionId: "",
    extensionLoaded: false,
    skinVerified: false,
    cdp: false,
    child,
  };

  if (typeof WebSocket !== "function") {
    console.log(
      "[CHICAGO BULLS] Node no expone WebSocket; se usan los flags clásicos de extensión."
    );
    return result;
  }

  let client = null;
  try {
    const devtools = await waitForDevToolsPort(
      profileDir,
      options.devtoolsTimeout || 20000
    );
    result.cdp = true;
    const wsPath = devtools.path || `/devtools/browser/${Date.now()}`;
    client = await createCdpClient(`ws://127.0.0.1:${devtools.port}${wsPath}`);

    try {
      const loaded = await client.send("Extensions.loadUnpacked", {
        path: PROJECT_DIR,
      });
      if (loaded && loaded.id) {
        result.extensionId = loaded.id;
        result.extensionLoaded = true;
      }
    } catch (error) {
      // It is expected when the legacy --load-extension flag already
      // loaded the same path in this browser session.
      result.extensionMessage = error.message;
    }

    let target = await findHaxballTarget(client);
    let targetId = target && target.targetId;

    if (!targetId) {
      const created = await client.send("Target.createTarget", {
        url: PLAY_URL,
      });
      targetId = created.targetId;
    }

    const attached = await client.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;

    await client.send("Page.enable", {}, sessionId);
    await client.send("Page.navigate", { url: PLAY_URL }, sessionId);

    result.skinVerified = await waitForSkin(
      client,
      sessionId,
      options.verifyTimeout || 18000
    );

    if (!result.skinVerified) {
      try {
        await client.send("Page.reload", { ignoreCache: true }, sessionId);
      } catch (_) {
        /* the page may still be navigating */
      }
      result.skinVerified = await waitForSkin(
        client,
        sessionId,
        options.verifyTimeout || 18000
      );
    }

    if (options.closeAfterVerify) {
      try {
        await client.send("Browser.close");
      } catch (_) {
        /* Browser.close closes the socket too */
      }
    }
  } catch (error) {
    result.error = error.message;
  } finally {
    if (client) client.close();
  }

  return result;
}

async function launch(options) {
  const settings = {
    headless: process.env.CB_HEADLESS === "1",
    closeAfterVerify: process.env.CB_CLOSE_AFTER_VERIFY === "1",
    ...options,
  };

  let browser;
  try {
    browser = resolveBrowser();
  } catch (error) {
    console.error(`[CHICAGO BULLS] ${error.message}`);
    return { ok: false, error: error.message };
  }

  if (!browser) {
    console.error(
      [
        "[CHICAGO BULLS] No se encontró Edge, Chrome ni Chromium.",
        "",
        "Instalá Microsoft Edge o Google Chrome y volvé a intentar.",
        "También podés indicar la ruta manualmente:",
        '  PowerShell:  $env:CB_BROWSER="C:\\ruta\\al\\navegador.exe"; npm start',
      ].join("\n")
    );
    return { ok: false, error: "browser-not-found" };
  }

  const profileDir = resolveProfileDir();
  console.log("[CHICAGO BULLS] Iniciando cliente real de HaxBall...");
  console.log(`  Navegador: ${browser}`);
  console.log(`  Perfil:    ${profileDir}`);
  console.log(`  Extensión: ${PROJECT_DIR}`);

  const recovery = prepareProfile(profileDir);
  if (recovery) {
    if (recovery.error) {
      console.error(
        `[CHICAGO BULLS] El perfil parece bloqueado (${recovery.reason}) pero no se pudo rotar: ${recovery.error}`
      );
      console.error(
        "  Cerrá todas las ventanas del navegador y ejecutá npm start de nuevo."
      );
    } else {
      console.log(
        "[CHICAGO BULLS] Perfil anterior bloqueado: " + recovery.reason + "."
      );
      console.log(`  Copia de seguridad: ${recovery.backup}`);
      console.log(
        `  Nuevo perfil limpio creado. Ajustes migrados: ${
          recovery.migrated ? "sí" : "no"
        }.`
      );
    }
  }

  const result = await openAndVerify(browser, profileDir, settings);
  const ok = result.skinVerified;

  if (result.extensionId) {
    console.log(`  Extensión cargada: ${result.extensionId}`);
  } else if (result.extensionMessage) {
    console.log(`  Extensión: flags del navegador (${result.extensionMessage})`);
  }

  if (ok) {
    console.log("[CHICAGO BULLS] Skin confirmada: HTML/CSS/JS activos en HaxBall.");
  } else if (result.error) {
    console.error(
      `[CHICAGO BULLS] No se pudo verificar la skin: ${result.error}`
    );
    console.error(
      "  Probá cerrar todas las ventanas de Edge/Chrome y ejecutar npm start de nuevo."
    );
  } else {
    console.error(
      "[CHICAGO BULLS] El navegador abrió HaxBall, pero la skin no se confirmó."
    );
    console.error(
      "  Cerrá todas las ventanas de Edge/Chrome y ejecutá npm start otra vez."
    );
    console.error(
      "  Si persiste, abrí edge://extensions, activá Modo desarrollador y cargá esta carpeta."
    );
  }

  return { ...result, ok };
}

if (require.main === module) {
  launch()
    .then((result) => {
      if (!result.ok && process.env.CB_VERIFY_STRICT === "1") process.exit(1);
    })
    .catch((error) => {
      console.error(`[CHICAGO BULLS] Error inesperado: ${error.stack || error}`);
      process.exit(1);
    });
}

module.exports = {
  PROJECT_DIR,
  PLAY_URL,
  resolveBrowser,
  resolveProfileDir,
  findBlockedExtension,
  rotateProfile,
  prepareProfile,
  launch,
  openAndVerify,
};
