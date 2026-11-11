'use strict';

/**
 * CHICAGO BULLS APP (CBA) - smoke test end-to-end.
 *
 * Lanza la app real con --remote-debugging-port y la verifica via el
 * protocolo DevTools (CDP) con un cliente WebSocket minimo propio (sin
 * dependencias nuevas):
 *   - UI CBA renderizada sobre la pagina real de haxball.com/play.
 *   - Logo, CSS, iframe del juego, lista de salas decorada.
 *   - Persistencia de ajustes en userData/cba-settings.json.
 *   - Paneles, ajustes, musica y bienvenida.
 *   - Union a una sala real: marcador, jugadores, chat, key strokes y macro.
 *
 * Uso: node tools/smoke.js   (requiere electron instalado en node_modules)
 *
 * El test restaura cba-settings.json al estado previo al terminar.
 */

const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 9333;
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const APPDATA = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
const SETTINGS_FILE = path.join(APPDATA, 'Chicago Bulls APP', 'cba-settings.json');
const BACKUP_FILE = SETTINGS_FILE + '.smoke-backup';

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

let passCount = 0;
let failCount = 0;
let skipCount = 0;

function check(name, ok, detail) {
    const extra = detail ? ' \u2014 ' + detail : '';
    if (ok === null) { skipCount++; console.log('  [SKIP] ' + name + extra); return; }
    if (ok) { passCount++; console.log('  [ OK ] ' + name + extra); }
    else { failCount++; console.log('  [FAIL] ' + name + extra); }
}

function readSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (e) { return null; }
}

/* ---------------------------------------------------- websocket minimo -- */

class TinyWS {
    constructor(url) {
        const m = /^ws:\/\/([^:]+):(\d+)(.*)$/.exec(url);
        if (!m) throw new Error('url ws invalida: ' + url);
        this.closed = false;
        this.handlers = { message: [], close: [] };
        this.buffer = Buffer.alloc(0);
        this.fragments = [];
        this.handshakeDone = false;
        this.openPromise = new Promise(function (resolve, reject) {
            this.resolveOpen = resolve;
            this.rejectOpen = reject;
        }.bind(this));
        this.socket = net.connect({ host: m[1], port: parseInt(m[2], 10) });
        this.pathname = m[3] || '/';
        this.socket.on('connect', () => this.sendHandshake());
        this.socket.on('data', (chunk) => this.onData(chunk));
        this.socket.on('error', (err) => { if (!this.handshakeDone) this.rejectOpen(err); });
        this.socket.on('close', () => {
            this.closed = true;
            this.handlers.close.forEach(function (fn) { try { fn(); } catch (e) {} });
        });
    }

    get open() { return this.openPromise; }

    on(evt, fn) { if (this.handlers[evt]) this.handlers[evt].push(fn); }

    sendHandshake() {
        const key = crypto.randomBytes(16).toString('base64');
        const req =
            'GET ' + this.pathname + ' HTTP/1.1\r\n' +
            'Host: 127.0.0.1:' + PORT + '\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            'Sec-WebSocket-Key: ' + key + '\r\n' +
            'Sec-WebSocket-Version: 13\r\n\r\n';
        this.socket.write(req);
    }

    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!this.handshakeDone) {
            const idx = this.buffer.indexOf('\r\n\r\n');
            if (idx < 0) return;
            const head = this.buffer.slice(0, idx).toString('utf8');
            if (!/^HTTP\/1\.1 101/.test(head)) {
                this.rejectOpen(new Error('handshake rechazado: ' + head.split('\r\n')[0]));
                return;
            }
            this.buffer = this.buffer.slice(idx + 4);
            this.handshakeDone = true;
            this.resolveOpen();
        }
        this.readFrames();
    }

    parseFrame() {
        const b = this.buffer;
        if (b.length < 2) return null;
        const fin = (b[0] & 0x80) !== 0;
        const opcode = b[0] & 0x0f;
        const masked = (b[1] & 0x80) !== 0;
        let len = b[1] & 0x7f;
        let off = 2;
        if (len === 126) {
            if (b.length < 4) return null;
            len = b.readUInt16BE(2);
            off = 4;
        } else if (len === 127) {
            if (b.length < 10) return null;
            len = Number(b.readBigUInt64BE(2));
            off = 10;
        }
        let maskKey = null;
        if (masked) {
            if (b.length < off + 4) return null;
            maskKey = b.slice(off, off + 4);
            off += 4;
        }
        if (b.length < off + len) return null;
        let payload = b.slice(off, off + len);
        if (maskKey) {
            const out = Buffer.allocUnsafe(len);
            for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
            payload = out;
        }
        this.buffer = b.slice(off + len);
        return { fin: fin, opcode: opcode, payload: payload };
    }

    readFrames() {
        for (;;) {
            const fr = this.parseFrame();
            if (!fr) break;
            if (fr.opcode === 1) { // texto
                if (fr.fin) this.emitText(fr.payload);
                else this.fragments.push(fr.payload);
            } else if (fr.opcode === 0) { // continuacion
                this.fragments.push(fr.payload);
                if (fr.fin) {
                    const joined = Buffer.concat(this.fragments);
                    this.fragments = [];
                    this.emitText(joined);
                }
            } else if (fr.opcode === 9) { // ping -> pong
                this.sendFrame(0x8A, fr.payload);
            } else if (fr.opcode === 8) { // close
                this.closed = true;
                try { this.socket.end(); } catch (eClose) {}
            }
            // pong (10): ignorar
        }
    }

    emitText(buf) {
        const text = buf.toString('utf8');
        this.handlers.message.forEach(function (fn) {
            try { fn(text); } catch (eMsg) {}
        });
    }

    sendFrame(opcode, payload) {
        const len = payload.length;
        let header;
        if (len < 126) {
            header = Buffer.alloc(2);
            header[1] = 0x80 | len;
        } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[1] = 0x80 | 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(len), 2);
        }
        header[0] = 0x80 | opcode;
        const key = crypto.randomBytes(4);
        const masked = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ key[i & 3];
        try { this.socket.write(Buffer.concat([header, key, masked])); } catch (eSend) {}
    }

    sendText(str) { this.sendFrame(0x1, Buffer.from(str, 'utf8')); }
}

/* ----------------------------------------------------------- capa CDP -- */

class CDP {
    constructor(ws) {
        this.ws = ws;
        this.nextId = 1;
        this.pending = new Map();
        ws.on('message', (text) => {
            let msg = null;
            try { msg = JSON.parse(text); } catch (eParse) { return; }
            if (msg && msg.id && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) p.reject(new Error(msg.error.message || 'error CDP'));
                else p.resolve(msg.result);
            }
        });
    }

    call(method, params, timeoutMs) {
        const id = this.nextId++;
        const ws = this.ws;
        return new Promise(function (resolve, reject) {
            const timer = setTimeout(function () {
                this.pending.delete(id);
                reject(new Error('timeout CDP: ' + method));
            }.bind({ pending: this.pending }), timeoutMs || 30000);
            this.pending.set(id, {
                resolve: function (v) { clearTimeout(timer); resolve(v); },
                reject: function (e) { clearTimeout(timer); reject(e); }
            });
            ws.sendText(JSON.stringify({ id: id, method: method, params: params || {} }));
        }.bind(this));
    }

    async evaluate(expression) {
        const res = await this.call('Runtime.evaluate', {
            expression: expression,
            returnByValue: true,
            awaitPromise: false
        });
        if (res.exceptionDetails) {
            throw new Error('excepcion en evaluate: ' +
                JSON.stringify(res.exceptionDetails).slice(0, 300));
        }
        return res.result ? res.result.value : undefined;
    }
}

function httpGetJson(what) {
    return new Promise(function (resolve, reject) {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: what, timeout: 4000 }, function (res) {
            let body = '';
            res.on('data', function (c) { body += c; });
            res.on('end', function () {
                try { resolve(JSON.parse(body)); } catch (eJson) { reject(eJson); }
            });
        });
        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout http ' + what)); });
    });
}

async function waitForPageTarget() {
    for (let i = 0; i < 130; i++) {
        await sleep(700);
        try {
            const list = await httpGetJson('/json/list');
            const page = list.find(function (t) {
                return t.type === 'page' && /haxball\.com\/play/.test(t.url || '') && t.webSocketDebuggerUrl;
            });
            if (page) return page;
        } catch (eList) {}
    }
    return null;
}

/* ---------------------------------------------------------------- main -- */

async function main() {
    console.log('== CHICAGO BULLS APP (CBA) \u00b7 smoke test ==');
    if (!fs.existsSync(ELECTRON)) {
        console.error('[smoke] electron no esta instalado (falta node_modules/electron/dist/electron.exe)');
        process.exit(2);
    }

    // Estado determinista: respaldar ajustes previos del usuario.
    const hadSettings = fs.existsSync(SETTINGS_FILE);
    if (hadSettings) {
        fs.copyFileSync(SETTINGS_FILE, BACKUP_FILE);
        fs.unlinkSync(SETTINGS_FILE);
        console.log('[smoke] respaldo de cba-settings.json creado');
    }

    const child = spawn(ELECTRON, ['.', '--remote-debugging-port=' + PORT], {
        cwd: ROOT,
        stdio: 'ignore'
    });
    console.log('[smoke] electron lanzado (pid ' + child.pid + ', puerto ' + PORT + ')');

    let exitCode = 0;
    let cdp = null;

    try {
        const target = await waitForPageTarget();
        if (!target) throw new Error('no aparecio la pagina de haxball.com/play (90 s)');
        console.log('[smoke] pagina cargada: ' + target.url);
        console.log('');
        await sleep(3500); // dejar cargar la lista de salas

        const ws = new TinyWS(target.webSocketDebuggerUrl);
        await ws.open;
        cdp = new CDP(ws);

        /* ------------ 1b. nickname inicial de HaxBall (perfil nuevo) ------ */
        // HaxBall pide el nickname antes de mostrar la lista de salas.
        let nickDone = false;
        for (let t = 0; t < 14 && !nickDone; t++) {
            await sleep(700);
            nickDone = await cdp.evaluate(`(function(){
                var d = document.querySelector('iframe.gameframe');
                d = d && d.contentDocument;
                if (!d) return false;
                var v = d.querySelector('.choose-nickname-view');
                if (!v) return false;
                var i = v.querySelector('[data-hook="input"]');
                if (i && !i.value) i.value = 'CBA-Smoke';
                var ok = v.querySelector('[data-hook="ok"]');
                if (ok) ok.click();
                return true;
            })()`);
        }
        if (!nickDone) console.log('[smoke] sin dialogo de nickname (ya guardado)');
        await sleep(1500);

        /* ---------------------- 1. estructura basica ---------------------- */
        console.log('-- UI CBA sobre haxball.com/play --');
        const st = await cdp.evaluate(`(function(){
            var f = document.querySelector('iframe.gameframe');
            var d = f ? f.contentDocument : null;
            var tb = document.querySelector('.cba-topbar');
            var kb = document.querySelector('.cba-keys');
            var brand = document.querySelector('.cba-brand img');
            return {
                root: !!document.getElementById('cba-root'),
                topbar: !!tb,
                topbarVisible: !!tb && !tb.classList.contains('cba-hidden'),
                brand: !!brand && brand.textContent !== undefined,
                logoLoaded: !!brand && brand.complete && brand.naturalWidth > 0,
                topCss: !!document.getElementById('cba-top-css'),
                baseCss: !!document.getElementById('cba-base-css'),
                iframe: !!f,
                gameReady: d ? d.readyState : '',
                gameCss: !!(d && d.getElementById('cba-game-css')),
                scoreAttr: d ? (d.documentElement.getAttribute('data-cba-score') || '') : '',
                barAttr: d ? (d.documentElement.getAttribute('data-cba-bar') || '') : '',
                keysPanel: !!kb,
                keysVisible: !!kb && !kb.classList.contains('cba-hidden'),
                scoreChip: !!document.querySelector('.cba-score'),
                settingsModal: !!document.querySelector('.cba-modal'),
                welcomeOpen: !!document.querySelector('.cba-modal-veil.open'),
                macroChip: !!document.querySelector("[data-cba='macro-chip']"),
                fpsChip: !!document.querySelector("[data-cba='fps-chip']"),
                toastsBox: !!document.querySelector('.cba-toasts')
            };
        })()`);
        check('raiz CBA (#cba-root)', st.root);
        check('barra CBA visible', st.topbar && st.topbarVisible);
        check('logo original logochicago.png cargado', st.logoLoaded);
        check('CSS base + barra inyectados', st.topCss && st.baseCss);
        check('iframe del juego encontrado', st.iframe);
        check('documento del juego listo', st.gameReady === 'complete');
        check('GAME_CSS inyectado en el iframe', st.gameCss);
        check('atributo data-cba-score=cba', st.scoreAttr === 'cba');
        check('atributo data-cba-bar=on', st.barAttr === 'on');
        check('panel key strokes presente y visible', st.keysPanel && st.keysVisible);
        check('chip de marcador CBA presente', st.scoreChip);
        check('modal de ajustes presente', st.settingsModal);
        check('chip MACRO presente', st.macroChip);
        check('chip FPS presente', st.fpsChip);

        /* ---------------------- 2. bienvenida ----------------------------- */
        if (st.welcomeOpen) {
            await cdp.evaluate(`document.querySelector('.cba-welcome .cba-btn').click()`);
            await sleep(700);
            const gone = await cdp.evaluate(`!document.querySelector('.cba-welcome')`);
            const saved = readSettings();
            check('bienvenida se cierra y persiste welcomeSeen', gone && saved && saved.welcomeSeen === true);
        } else {
            check('bienvenida (primer arranque)', null, 'ya vista en ajustes previos');
        }

        /* ---------------- 2b. esperar lista de salas del master ------------ */
        let roomlistInfo = { rows: 0, count: '', noticeHidden: true };
        for (let t = 0; t < 40 && roomlistInfo.rows === 0; t++) {
            await sleep(750);
            roomlistInfo = await cdp.evaluate(`(function(){
                var d = document.querySelector('iframe.gameframe').contentDocument;
                var tb = d.querySelector("tbody[data-hook='list']");
                return {
                    rows: tb ? tb.children.length : 0,
                    count: (d.querySelector("[data-hook='count']") || {textContent:''}).textContent.trim(),
                    noticeHidden: !!(d.querySelector("[data-hook='notice']") || {hidden:true}).hidden
                };
            })()`);
        }
        const stars = await cdp.evaluate(`document.querySelectorAll("iframe.gameframe").length ? document.querySelector('iframe.gameframe').contentDocument.querySelectorAll("tbody[data-hook='list'] .cba-fav-star").length : 0`);
        check('lista de salas con filas', roomlistInfo.rows > 0,
            roomlistInfo.rows + ' salas \u00b7 ' + roomlistInfo.count);
        check('estrellas de favoritas en cada fila',
            roomlistInfo.rows > 0 ? stars === roomlistInfo.rows : null, stars + ' estrellas');

        /* ---------------------- 3. key strokes + persistencia -------------- */
        console.log('-- key strokes y persistencia --');
        await cdp.evaluate(`document.querySelector('.cba-tb-btn[data-cba="keys"]').click()`);
        await sleep(900);
        const k1 = await cdp.evaluate(`document.querySelector('.cba-keys').classList.contains('cba-hidden')`);
        const s1 = readSettings();
        check('key strokes se oculta con el boton', k1 === true);
        check('keystrokesVisible=false persistado', !!s1 && s1.ui && s1.ui.keystrokesVisible === false);
        await cdp.evaluate(`document.querySelector('.cba-tb-btn[data-cba="keys"]').click()`);
        await sleep(900);
        const k2 = await cdp.evaluate(`!document.querySelector('.cba-keys').classList.contains('cba-hidden')`);
        const s2 = readSettings();
        check('key strokes vuelve a mostrarse', k2 === true);
        check('keystrokesVisible=true persistado', !!s2 && s2.ui && s2.ui.keystrokesVisible === true);

        /* ---------------------- 4. paneles --------------------------------- */
        console.log('-- paneles --');
        await cdp.evaluate(`document.querySelector('.cba-tb-btn[data-cba="rooms"]').click()`);
        await sleep(500);
        const rp = await cdp.evaluate(`(function(){
            var p = document.querySelector('.cba-panel');
            return {
                open: p.classList.contains('open'),
                minis: document.querySelectorAll('.cba-rooms-stats .cba-mini').length,
                first: (document.querySelector('.cba-rooms-stats .cba-mini b') || {textContent:''}).textContent
            };
        })()`);
        check('panel de salas abre', rp.open);
        check('estadisticas de salas (3 mini-tarjetas)', rp.minis === 3, rp.first + ' salas');
        await cdp.evaluate(`document.querySelector('.cba-panel-close').click()`);
        await sleep(300);
        check('panel se cierra', await cdp.evaluate(`!document.querySelector('.cba-panel').classList.contains('open')`) === true);

        /* ---------------------- 5. ajustes + macro on/off ------------------ */
        console.log('-- ajustes y macro --');
        await cdp.evaluate(`document.querySelector('.cba-tb-btn[data-cba="settings"]').click()`);
        await sleep(400);
        const sm = await cdp.evaluate(`(function(){
            var veil = document.querySelector('.cba-modal-veil');
            var box = document.querySelector('.cba-modal');
            return {
                open: !!veil && veil.classList.contains('open'),
                visible: !!box && !!box.offsetParent,
                tabs: document.querySelectorAll('.cba-tab').length,
                macroPane: !!document.querySelector('[data-cba-pane="macro"]'),
                aboutPane: !!document.querySelector('[data-cba-pane="about"]')
            };
        })()`);
        check('modal de ajustes abre', sm.open && sm.visible);
        check('6 pesta\u00f1as de ajustes', sm.tabs === 6);
        check('pesta\u00f1a Macro y Acerca de', sm.macroPane && sm.aboutPane);
        await cdp.evaluate(`document.querySelector('[data-cba-ctl="macroen"]').click()`);
        await sleep(900);
        const s3 = readSettings();
        check('macro.enabled=true persistado', !!s3 && s3.macro && s3.macro.enabled === true);
        await cdp.evaluate(`document.querySelector('.cba-modal-close').click()`);
        await sleep(300);
        const smClosed = await cdp.evaluate(`(function(){
            var veil = document.querySelector('.cba-modal-veil');
            return !veil || !veil.classList.contains('open');
        })()`);
        check('modal se cierra', smClosed === true);

        /* ---------------------- 6. musica --------------------------------- */
        console.log('-- musica --');
        await cdp.evaluate(`document.querySelector('.cba-tb-btn[data-cba="music"]').click()`);
        await sleep(400);
        const playExpr = `(function(){
            var b = Array.prototype.slice.call(document.querySelectorAll('.cba-panel .cba-btn'))
                .filter(function (x) { return /REPRODUCIR|PAUSAR/.test(x.textContent); })[0];
            if (!b) return '';
            b.click();
            return b.textContent;
        })()`;
        const readPlayExpr = `(function(){
            var b = Array.prototype.slice.call(document.querySelectorAll('.cba-panel .cba-btn'))
                .filter(function (x) { return /REPRODUCIR|PAUSAR/.test(x.textContent); })[0];
            return b ? b.textContent : '';
        })()`;
        await cdp.evaluate(playExpr);
        await sleep(700);
        const m1 = readSettings();
        const t1 = await cdp.evaluate(readPlayExpr);
        check('musica arranca (boton pasa a PAUSAR)', t1 === 'PAUSAR');
        check('music.on=true persistado', !!m1 && m1.music && m1.music.on === true);
        await cdp.evaluate(playExpr);
        await sleep(700);
        const m2 = readSettings();
        const t2 = await cdp.evaluate(readPlayExpr);
        check('musica se detiene (boton pasa a REPRODUCIR)', t2 === 'REPRODUCIR');
        check('music.on=false persistado', !!m2 && m2.music && m2.music.on === false);
        await cdp.evaluate(`document.querySelector('.cba-panel-close').click()`);
        await sleep(300);

        /* ---------------------- 7. sala real ------------------------------- */
        console.log('-- sala real de HaxBall --');
        let joined = false;
        let joinNote = '';
        try {
            for (let attempt = 0; attempt < 4 && !joined; attempt++) {
                const clicked = await cdp.evaluate(`(function(){
                    var f = document.querySelector('iframe.gameframe');
                    var d = f && f.contentDocument;
                    if (!d) return false;
                    var rows = Array.prototype.slice.call(d.querySelectorAll("tbody[data-hook='list'] tr"))
                        .filter(function (r) {
                            var pass = r.querySelector("[data-hook='pass']");
                            return !r.classList.contains('cba-full') &&
                                !(pass && pass.textContent && pass.textContent.trim()) &&
                                !(pass && pass.querySelector('i'));
                        });
                    var r = rows[${attempt}];
                    if (!r) return false;
                    r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                    return true;
                })()`);
                if (!clicked) { joinNote = 'sin salas abiertas disponibles'; break; }
                await sleep(1600);
                // dialogo de nickname (primer uso)
                await cdp.evaluate(`(function(){
                    var d = document.querySelector('iframe.gameframe').contentDocument;
                    var v = d.querySelector('.choose-nickname-view');
                    if (!v) return false;
                    var i = v.querySelector('[data-hook="input"]');
                    if (i && !i.value) i.value = 'CBA-Smoke';
                    var ok = v.querySelector('[data-hook="ok"]');
                    if (ok) ok.click();
                    return true;
                })()`);
                for (let t = 0; t < 22 && !joined; t++) {
                    await sleep(800);
                    joined = await cdp.evaluate(`(function(){
                        var d = document.querySelector('iframe.gameframe').contentDocument;
                        return !!d.querySelector('.room-view') || !!d.querySelector("[data-hook='room-name']");
                    })()`);
                }
                if (!joined) {
                    await cdp.evaluate(`(function(){
                        var d = document.querySelector('iframe.gameframe').contentDocument;
                        var c = d.querySelector('[data-hook="cancel"]');
                        if (c) c.click();
                        return true;
                    })()`);
                    await sleep(700);
                }
            }
        } catch (eJoin) {
            joinNote = eJoin.message;
        }

        if (joined) {
            check('union a sala real de HaxBall', true);
            await sleep(1500); // scanGameHooks (debounce) + observers
            const ri = await cdp.evaluate(`(function(){
                var f = document.querySelector('iframe.gameframe');
                var d = f.contentDocument;
                var n = d.querySelector("[data-hook='room-name']");
                return {
                    name: n ? n.textContent.trim() : '',
                    gameView: !!d.querySelector('.game-view'),
                    chipVisible: !document.querySelector('.cba-score').classList.contains('cba-hidden'),
                    scoreRed: (document.querySelector('.cba-score .sc') || {textContent:''}).textContent
                };
            })()`);
            check('nombre de sala leido por CBA', ri.name.length > 0, ri.name);
            check('vista de partida (.game-view)', ri.gameView);

            let chipOk = ri.chipVisible;
            for (let t = 0; t < 4 && !chipOk; t++) {
                await sleep(800);
                chipOk = await cdp.evaluate(`!document.querySelector('.cba-score').classList.contains('cba-hidden')`);
            }
            check('marcador CBA visible en sala', chipOk);

            // jugadores
            await cdp.evaluate(`document.querySelector('.cba-tb-btn[data-cba="players"]').click()`);
            await sleep(800);
            const pp = await cdp.evaluate(`(function(){
                return {
                    rn: (document.querySelector('.cba-roominfo .rn') || {textContent:''}).textContent.trim(),
                    players: document.querySelectorAll('.cba-pl-item').length,
                    sub: (document.querySelector('.cba-panel-sub') || {textContent:''}).textContent
                };
            })()`);
            check('panel de jugadores lee la sala', pp.rn.length > 0, pp.rn + ' \u00b7 ' + pp.sub);

            // chat
            await cdp.evaluate(`document.querySelector('.cba-tb-btn[data-cba="chat"]').click()`);
            await sleep(1000);
            const cp = await cdp.evaluate(`(function(){
                return {
                    lines: document.querySelectorAll('.cba-chat-line').length,
                    sub: (document.querySelector('.cba-panel-sub') || {textContent:''}).textContent
                };
            })()`);
            check('historial de chat captura mensajes', cp.lines > 0, cp.sub);

            // key strokes en vivo
            const upCode = await cdp.evaluate(`(function(){
                var k = document.querySelector('.cba-keys .row .cba-key');
                return k ? (k.dataset.code || '') : '';
            })()`);
            if (upCode) {
                await cdp.evaluate(`(function(){
                    var d = document.querySelector('iframe.gameframe').contentDocument;
                    d.dispatchEvent(new KeyboardEvent('keydown', { code: '${upCode}', bubbles: true, cancelable: true }));
                    return true;
                })()`);
                await sleep(150);
                const lit = await cdp.evaluate(`(function(){
                    var k = document.querySelector('.cba-keys .row .cba-key');
                    return k ? k.classList.contains('active') : false;
                })()`);
                check('key strokes ilumina la tecla al instante', lit === true);
                await cdp.evaluate(`(function(){
                    var d = document.querySelector('iframe.gameframe').contentDocument;
                    d.dispatchEvent(new KeyboardEvent('keyup', { code: '${upCode}', bubbles: true, cancelable: true }));
                    return true;
                })()`);
                await sleep(150);
                const unlit = await cdp.evaluate(`(function(){
                    var k = document.querySelector('.cba-keys .row .cba-key');
                    return k ? !k.classList.contains('active') : false;
                })()`);
                check('key strokes se apaga al soltar', unlit === true);
            } else {
                check('key strokes ilumina la tecla', null, 'sin codigo resuelto');
            }

            // macro (tecla M por defecto)
            await cdp.evaluate(`(function(){
                var d = document.querySelector('iframe.gameframe').contentDocument;
                if (d.activeElement && d.activeElement.blur) d.activeElement.blur();
                return true;
            })()`);
            await cdp.evaluate(`(function(){
                var d = document.querySelector('iframe.gameframe').contentDocument;
                d.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true, cancelable: true }));
                return true;
            })()`);
            await sleep(450);
            const chip1 = await cdp.evaluate(`(document.querySelector("[data-cba='macro-chip'] .cba-chip-label") || {textContent:''}).textContent`);
            check('MACRO ON con la tecla M en sala', String(chip1).trim() === 'MACRO ON');
            await sleep(300);
            await cdp.evaluate(`(function(){
                var d = document.querySelector('iframe.gameframe').contentDocument;
                d.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true, cancelable: true }));
                return true;
            })()`);
            await sleep(450);
            const chip2 = await cdp.evaluate(`(document.querySelector("[data-cba='macro-chip'] .cba-chip-label") || {textContent:''}).textContent`);
            check('MACRO OFF al pulsar M de nuevo', String(chip2).trim() === 'MACRO OFF');
        } else {
            check('union a sala real de HaxBall', null, joinNote || 'no se pudo entrar en ninguna sala');
            check('marcador/jugadores/chat/macro en sala', null, 'depende de la union a sala');
        }
    } catch (err) {
        console.error('[smoke] ERROR: ' + ((err && err.stack) || err));
        exitCode = 1;
    } finally {
        console.log('');
        console.log('-- cierre --');
        try {
            const ver = await httpGetJson('/json/version');
            if (ver && ver.webSocketDebuggerUrl) {
                const bws = new TinyWS(ver.webSocketDebuggerUrl);
                await bws.open;
                const bcdp = new CDP(bws);
                await bcdp.call('Browser.close');
                await sleep(1800);
            }
        } catch (eClose) {
            try { child.kill(); } catch (eKill) {}
        }
        try {
            if (!child.killed && child.exitCode == null) {
                await sleep(2500);
                if (child.exitCode == null) child.kill();
            }
        } catch (eKill2) {}
        await sleep(400);

        // restaurar estado previo del usuario
        try {
            if (hadSettings) {
                fs.copyFileSync(BACKUP_FILE, SETTINGS_FILE);
                fs.unlinkSync(BACKUP_FILE);
                console.log('[smoke] cba-settings.json del usuario restaurado');
            } else if (fs.existsSync(SETTINGS_FILE)) {
                fs.unlinkSync(SETTINGS_FILE);
                console.log('[smoke] cba-settings.json eliminado (primer arranque limpio)');
            }
        } catch (eRestore) {
            console.error('[smoke] no se pudo restaurar ajustes: ' + eRestore.message);
        }
    }

    console.log('');
    console.log('resultado: ' + passCount + ' OK, ' + failCount + ' FAIL, ' + skipCount + ' SKIP');
    process.exit(failCount > 0 || exitCode !== 0 ? 1 : 0);
}

main().catch(function (err) {
    console.error('[smoke] fallo fatal: ' + ((err && err.stack) || err));
    process.exit(1);
});
