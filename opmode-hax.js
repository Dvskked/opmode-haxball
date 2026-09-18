/* ======================================================================
   OpMode · Haxball Client Assistant   ·   v4.0.0
   ----------------------------------------------------------------------
   Script 100 % cliente para pegar en la consola DevTools (F12) de
   https://www.haxball.com/play   (se auto-adapta: consola del iframe del
   juego O documento de nivel superior; mismo origen).

   NOVEDADES v4 (rendimiento)
   - BRINDADOS BARATOS: se eliminó shadowBlur (era EL asesino de FPS).
     Los brillos ahora son trazos multicapa con alpha progresivo.
     A simple vista se ven igual; miden ~30-50 % más baratos de pintar.
   - DPR LIMITADO: el overlay ya no pinta a devicePixelRatio completo.
     Se limita a 1.75 (nitidez + rendimiento en pantallas HiDPI).
   - MOTOR ADAPTATIVO: cada análisis se cronometra. Si cuesta >7 ms el
     motor sube la cadencia (tickEvery 1→6) y baja la resolución de
     muestreo (320→160px). Si sobra (~<2.5 ms) vuelve a subir calidad.
     En máquinas débiles arranca ya configurado ahorrando CPU.
   - SIN LECTURAS INÚTILES: no se lee el canvas si el overlay está oculto,
     si la fuente es "custom", si no hay canvas (Demo), ni en pestañas
     ocultas. Se reutilizan buffers (Uint8Array de componentes conexas,
     contexto 2D cacheado, getImageData en caché con willReadFrequently).
   - MENÚ SIN DOM SPAM: el estado se refresca cada ~300 ms, no por frame.
   - El bucle del juego NO se toca: no interceptamos su rAF ni su canvas.

   NOVEDADES v4 (funcional)
   - CORREGIDO el mapeo campo→mundo (toWorld): el cálculo anterior
     desplazaba las líneas cuando hay letterbox o el detector del estadio
     suaviza su rectángulo (EMA). Ahora las líneas encajan en el campo.
   - Balón detectado con umbral difuso + radio escalado al mundo y
     continuidad temporal (premio a la posición prevista por velocidad).
   - Nuevas ayudas: PREDICCIÓN con rebotes y marcador de impacto en el
     arco, ESTELA del balón, HUD de velocidad/tiempo a gol, ALERTA DE
     PELIGRO (rival cerca), ARO DE TIRO del balón, CROSSHAIR propio,
     AROS DE EQUIPO (neon alrededor de cada jugador) y "soy yo" siempre
     marcado con triángulo.
   - DECORACIÓN DE CAMPO: se redibujan encima línea de medio campo,
     círculo central, áreas y esquinas con estética neon y 6 TEMAS de
     color (neon, ice, inferno, royal, toxic, gold).
   - Velocidad del balón suavizada con EMA para que la trayectoria no
     vibre.

   ATAJOS:
     M menú · N balón→arco · J yo→balón · B radio · V trayectoria ·
     P predicción · T estela · U HUD · D peligro · G campo · C crosshair ·
     H aros · K overlay
   ====================================================================== */
(() => {
  'use strict';

  if (window.OpMode && window.OpMode._opmode) {
    console.warn('[OpMode] Ya hay una instancia activa. Usa OpMode.destroy() y vuelve a pegar.');
    return;
  }

  /* ============================================================
     1. CONFIGURACIÓN  (por defecto + persistencia localStorage)
     ============================================================ */

  /* Perfil de máquina: si es débil, arranque conservador (menos carga) */
  const weakMachine =
    (typeof navigator !== 'undefined') &&
    (((navigator.deviceMemory && navigator.deviceMemory <= 2) || 0) ||
     ((navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) || 0) ||
     (navigator.platform && /android|iphone|ipad|ipod/i.test(navigator.platform))) ? 1 : 0;

  const WORLD_W = 800, WORLD_H = 400;
  const GOAL_HALF = 25;                       /* semiancho de la boca del arco */

  const THEMES = {
    neon:   { deco: '#00ffd5', accent: '#00ffd5', goal: '#39ff7a', warn: '#ff5252' },
    ice:    { deco: '#4d9fff', accent: '#4d9fff', goal: '#7ad0ff', warn: '#ffb04d' },
    inferno:{ deco: '#ff9d2e', accent: '#ff9d2e', goal: '#ffd94d', warn: '#ff5252' },
    royal:  { deco: '#b24dff', accent: '#b24dff', goal: '#ff6ad5', warn: '#ff5252' },
    toxic:  { deco: '#39ff7a', accent: '#39ff7a', goal: '#c6ff4d', warn: '#ff5252' },
    gold:   { deco: '#ffd94d', accent: '#ffd94d', goal: '#fff6c2', warn: '#ff5252' }
  };

  const DEFAULTS = {
    version: '4.0.0',
    worldW: WORLD_W,
    worldH: WORLD_H,
    ballRadius: 10,
    playerRadius: 15,
    reachMult: 1.6,          /* radio de alcance dibujado en unidades de mundo */
    sampleWTarget: weakMachine ? 256 : 320,
    tickEvery: weakMachine ? 3 : 2,   /* inicial; el motor adaptativo lo regula */
    adapt: true,             /* motor adaptativo de rendimiento */
    maxDpr: 1.75,            /* tope de resolución del overlay */
    autoMe: true,            /* "yo" = jugador más estable cerca del balón     */
    holdMs: 500,             /* cuánto conservar la última detección válida    */
    prediction: { time: 0.90, bounces: 3, drag: 1.9, rest: 0.92, min: 22 },
    trail: { len: 22 },
    vis: {
      lineBallGoal: true,
      lineMeBall: true,
      radius: true,
      trajectory: true,
      predict: true,
      trail: false,
      hud: true,
      danger: true,
      fieldDeco: true,
      crosshair: true,
      glowPlayers: true,
      demo: true,
      overlay: true
    },
    style: {
      color: '#00ffd5',
      width: 4,
      glow: true,            /* brillo multicapa */
      theme: 'neon'
    },
    keys: {
      menu: 'KeyM', lbg: 'KeyN', lmb: 'KeyJ', radius: 'KeyB', traj: 'KeyV',
      predict: 'KeyP', trail: 'KeyT', hud: 'KeyU', danger: 'KeyD',
      field: 'KeyG', cross: 'KeyC', glow: 'KeyH', overlay: 'KeyK'
    }
  };

  let CFG = {};
  const SSKEY = 'opmode_cfg_v4';

  function persist() {
    try {
      localStorage.setItem(SSKEY, JSON.stringify({
        vis: CFG.vis, style: CFG.style, autoMe: CFG.autoMe
      }));
    } catch (e) {}
  }

  function loadCfg() {
    try {
      const s = JSON.parse(localStorage.getItem(SSKEY) || '{}');
      CFG = {
        ...JSON.parse(JSON.stringify(DEFAULTS)),
        vis: { ...DEFAULTS.vis, ...(s.vis || {}) },
        style: { ...DEFAULTS.style, ...(s.style || {}) },
        autoMe: s.autoMe !== undefined ? !!s.autoMe : DEFAULTS.autoMe
      };
      if (!THEMES[CFG.style.theme]) CFG.style.theme = 'neon';
    } catch (e) { CFG = JSON.parse(JSON.stringify(DEFAULTS)); }
  }

  const util = {
    log(msg) {
      console.log('%c[OPMODE] ' + msg, 'color:#00ffd5;font-weight:bold;background:#0a121a;padding:2px 6px;border-radius:3px');
    },
    clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
    dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  };

  /* ============================================================
     2. MOTOR ADAPTATIVO DE RENDIMIENTO
     Mide el coste real de cada análisis de píxeles y ajusta por sí
     solo la cadencia y la resolución de muestreo para mantener el
     juego fluido (objetivo: < ~6 ms por análisis).
     ============================================================ */
  const Perf = {
    msEMA: 2,          /* media exponencial del coste del análisis (ms) */
    tick: DEFAULTS.tickEvery,
    res: DEFAULTS.sampleWTarget,
    t0: 0,

    begin() { this.t0 = performance.now(); },
    end() {
      const ms = performance.now() - this.t0;
      if (!CFG.adapt) return ms;
      this.msEMA = this.msEMA * 0.85 + ms * 0.15;
      if (this.msEMA > 7.5) {
        if (this.tick < 6) this.tick++;
        if (this.res > 160) this.res = Math.max(160, this.res - 40);
      } else if (this.msEMA < 2.5) {
        if (this.tick > 1) this.tick--;
        if (this.res < CFG.sampleWTarget) this.res = Math.min(CFG.sampleWTarget, this.res + 40);
      }
      return ms;
    },
    modeLabel() { return 'A' + Perf.tick + '·' + Perf.res + 'px'; }
  };

  /* ============================================================
     3. ANFITRIÓN (documento, iframes y canvas del juego)
     ============================================================ */
  const Host = {
    topWin: null, doc: null, iframes: [],
    canvas: null, candidates: [], rect: null,
    lastScan: 0,

    init() {
      this.topWin = (window.top && window.top.location.origin === window.location.origin) ? window.top : window;
      this.doc = this.topWin.document;
      this.scan();
    },

    gather() {
      const out = { iframes: [], canvases: [] };
      try {
        out.iframes = Array.from(this.doc.querySelectorAll('iframe'));
        const docs = [this.doc];
        for (const f of out.iframes) {
          try { const d = f.contentDocument; if (d) docs.push(d); } catch (e) {}
        }
        for (const d of docs) {
          const list = d.querySelectorAll ? d.querySelectorAll('canvas') : [];
          for (const c of list) {
            const r = c.getBoundingClientRect();
            if (!r || r.width < 120 || r.height < 80) continue;
            out.canvases.push({ c, doc: d, area: r.width * r.height });
          }
        }
      } catch (e) {}
      out.canvases.sort((a, b) => b.area - a.area);
      return out;
    },

    idx: 0,
    select() {
      this.idx = 0;
      this.canvas = this.candidates.length ? this.candidates[0].c : null;
      this.applyCanvas();
    },
    advance() {
      if (this.candidates.length <= 1) return;
      this.idx = (this.idx + 1) % this.candidates.length;
      this.canvas = this.candidates[this.idx].c;
      this.applyCanvas();
    },
    applyCanvas() {
      Sampler.reset();
      Vision.resetField();
      this.rect = null;
    },

    scan() {
      const now = Date.now();
      if (now - this.lastScan < 800 && this.canvas && this.canvas.isConnected) return;
      this.lastScan = now;
      const g = this.gather();
      this.iframes = g.iframes;
      this.candidates = g.canvases;
      if (!this.canvas || !this.canvas.isConnected) this.select();
    },

    canvasRect() {
      if (this.canvas && this.canvas.isConnected) {
        const r = this.canvas.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { this.rect = r; return r; }
      }
      return this.rect;
    },

    viewport() {
      return { w: this.topWin.innerWidth || window.innerWidth, h: this.topWin.innerHeight || window.innerHeight };
    }
  };

  /* ============================================================
     4. OVERLAY (un solo canvas, invisible al ratón, DPR limitado)
     ============================================================ */
  const Overlay = {
    canvas: null, ctx: null, w: 0, h: 0,

    ensure() {
      if (this.canvas && this.canvas.isConnected) return;
      this.canvas = Host.doc.createElement('canvas');
      this.canvas.setAttribute('data-opmode', '1');
      this.canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:2147482600;pointer-events:none';
      Host.doc.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
    },

    remove() {
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null; this.ctx = null;
    },

    sync() {
      this.ensure();
      const v = Host.viewport();
      const dpr = Math.min(this.canvas.ownerDocument.defaultView.devicePixelRatio || 1, CFG.maxDpr);
      const pw = Math.round(v.w * dpr), ph = Math.round(v.h * dpr);
      if (this.canvas.width !== pw) this.canvas.width = pw;
      if (this.canvas.height !== ph) this.canvas.height = ph;
      this.w = v.w; this.h = v.h;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, v.w, v.h);
    }
  };

  /* ============================================================
     5. MUESTREADOR (miniatura RGBA barata, 2D + fallback WebGL)
     ============================================================ */
  const Sampler = {
    sw: 0, sh: 0,
    off: null, offCtx: null, offImg: null,
    gl: null, glBuf: null, glW: 0, glH: 0,
    mode: null, ok: false, tried: {},

    reset() { this.ok = false; this.mode = null; this.tried = {}; },

    /* Miniatura RGBA del canvas del juego. El offscreen se cachea y
       se marca willReadFrequently para acelerar getImageData. */
    frame() {
      const c = Host.canvas;
      if (!c || !c.isConnected) return null;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return null;

      const target = Math.min(Perf.res, cw);
      const step = Math.max(1, Math.round(cw / target));
      const sw = Math.floor(cw / step);
      const sh = Math.max(1, Math.floor(ch / step));

      /* ---- intento 2D (el juego es 2D) ---- */
      if (this.mode !== 'webgl') {
        const ctx = this.get2D(c);
        if (!ctx) this.mode = 'webgl';
        else {
          try {
            if (!this.off) {
              this.off = Host.doc.createElement('canvas');
              this.offCtx = this.off.getContext('2d', { willReadFrequently: true });
            }
            if (this.off.width !== sw) this.off.width = sw;
            if (this.off.height !== sh) this.off.height = sh;
            this.offCtx.drawImage(c, 0, 0, sw, sh);
            this.offImg = this.offCtx.getImageData(0, 0, sw, sh);
            this.sw = sw; this.sh = sh;
            this.ok = true;
            return this.offImg.data;
          } catch (e) { this.mode = 'webgl'; }
        }
      }

      /* ---- intento WebGL (fallback raro) ---- */
      try {
        let g = this.gl;
        if (!g || !c.__opmode_gl) {
          g = c.getContext('webgl') || c.getContext('experimental-webgl');
          c.__opmode_gl = !!g;
        }
        if (!g) return null;
        this.gl = g;
        if (!this.glBuf || this.glW !== cw || this.glH !== ch) {
          this.glW = cw; this.glH = ch;
          this.glBuf = new Uint8Array(cw * ch * 4);
        }
        g.readPixels(0, 0, cw, ch, g.RGBA, g.UNSIGNED_BYTE, this.glBuf);

        if (!this.off) {
          this.off = Host.doc.createElement('canvas');
          this.offCtx = this.off.getContext('2d', { willReadFrequently: true });
        }
        if (!this.offImg || this.offImg.width !== sw || this.offImg.height !== sh) {
          this.offImg = this.offCtx.createImageData(sw, sh);
        }
        const src = this.glBuf, dst = this.offImg.data;
        let o = 0;
        for (let y = 0; y < sh; y++) {
          const srcY = (ch - 1) - (y * step + (step >> 1));
          if (srcY < 0 || srcY >= ch) { o += sw * 4; continue; }
          const row = srcY * cw;
          for (let x = 0; x < sw; x++) {
            const p = (row + x * step + (step >> 1)) * 4;
            dst[o] = src[p]; dst[o + 1] = src[p + 1]; dst[o + 2] = src[p + 2]; dst[o + 3] = 255;
            o += 4;
          }
        }
        this.sw = sw; this.sh = sh;
        this.ok = true;
        return dst;
      } catch (e) { return null; }
    },

    /* Contexto 2D real del juego, cacheado (sin getContext por frame) */
    get2D(c) {
      try {
        if (c.__opmode_2dctx) return c.__opmode_2dctx;
        if (c.__opmode_2d === undefined) {
          const ctx = c.getContext('2d', { willReadFrequently: true });
          c.__opmode_2d = !!ctx;
          if (ctx) c.__opmode_2dctx = ctx;
          return c.__opmode_2d ? c.__opmode_2dctx : null;
        }
        return c.__opmode_2d ? c.__opmode_2dctx : null;
      } catch (e) { return null; }
    },

    isBlank(data) {
      let sum = 0, n = 0;
      for (let i = 0; i < data.length; i += 64) { sum += data[i] + data[i + 1] + data[i + 2]; n += 3; }
      return n === 0 || (sum / n) < 3;
    }
  };

  /* ============================================================
     6. VISIÓN (campo, balón, jugadores, "yo", velocidad, demo)
     ============================================================ */
  const Vision = {
    data: null,
    field: null,
    ball: null,            /* {x,y} en coords de muestra */
    ballWorld: null,
    ballSmooth: null,      /* {x,y} suavizado para dibujar (sin vibración) */
    players: [],           /* [{x,y,color}] en coords de muestra */
    playersWorld: [],      /* [{x,y,color,wx,wy}] en mundo */
    me: null,
    vx: 0, vy: 0, lastBall: null,
    blankFrames: 0, emptyFail: 0,

    resetField() { this.field = null; this.ball = null; this.ballWorld = null; this.ballSmooth = null; this.blankFrames = 0; this.emptyFail = 0; },

    /* Reusamos un único Uint8Array para componentes conexas (sin GC). */
    _seen: null,
    _seenSize: 0,
    compsMask(len) {
      if (!this._seen || this._seen.length < len) { this._seen = new Uint8Array(len); this._seenSize = len; }
      this._seen.fill(0);
      return this._seen;
    },

    components(mask, sw, sh) {
      const seen = this.compsMask(sw * sh);
      const out = [];
      for (let y = 1; y < sh - 1; y++) {
        const row = y * sw;
        for (let x = 1; x < sw - 1; x++) {
          const i = row + x;
          if (seen[i] || !mask(i)) continue;
          const stack = [i];
          let minX = x, maxX = x, minY = y, maxY = y, sumX = 0, sumY = 0, n = 0;
          seen[i] = 1;
          while (stack.length) {
            const c = stack.pop();
            const cx = c % sw, cy = (c - cx) / sw;
            sumX += cx + 0.5; sumY += cy + 0.5; n++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            for (const nb of [c - 1, c + 1, c - sw, c + sw]) {
              if (nb < 0 || nb >= seen.length) continue;
              if (seen[nb] || !mask(nb)) continue;
              const nbx = nb % sw, nby = (nb - nbx) / sw;
              if (nbx < 1 || nbx >= sw - 1 || nby < 1 || nby >= sh - 1) continue;
              seen[nb] = 1; stack.push(nb);
            }
          }
          if (n < 5) continue;
          out.push({ x: sumX / n, y: sumY / n, w: maxX - minX + 1, h: maxY - minY + 1, minX, maxX, minY, maxY, area: n });
        }
      }
      return out;
    },

    detectField(data, sw, sh) {
      let sx0 = 1e9, sy0 = 1e9, sx1 = -1, sy1 = -1, count = 0;
      for (let y = 0; y < sh; y += 2) {
        const row = y * sw * 4;
        for (let x = 0; x < sw; x += 2) {
          const p = row + x * 4;
          const r = data[p], g = data[p + 1], b = data[p + 2];
          if (g >= 60 && g <= 235 && g >= r + 25 && g >= b + 25) {
            if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
            if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
            count++;
          }
        }
      }
      if (count < 120) return null;
      const f = { x0: sx0, y0: sy0, x1: sx1, y1: sy1 };
      if (!this.field) { this.field = f; return f; }
      const a = 0.15;
      this.field.x0 += a * (f.x0 - this.field.x0);
      this.field.y0 += a * (f.y0 - this.field.y0);
      this.field.x1 += a * (f.x1 - this.field.x1);
      this.field.y1 += a * (f.y1 - this.field.y1);
      return this.field;
    },

    /* Posición prevista del balón (para premiar continuidad con velocidad) */
    expectedBall() {
      if (!this.lastBall) return null;
      return { x: this.lastBall.x + this.vx * 0.05, y: this.lastBall.y + this.vy * 0.05 };
    },

    detectBall(data, sw, sh, f) {
      const mask = (i) => {
        const p = i * 4;
        /* blanco difuso: luminancia alta en los 3 canales */
        return data[p] >= 185 && data[p + 1] >= 185 && data[p + 2] >= 185;
      };
      const comps = this.components(mask, sw, sh);
      const scale = sw / CFG.worldW;
      const expR = CFG.ballRadius * scale;
      const expArea = Math.PI * expR * expR;
      const exp = this.expectedBall();
      let best = null, score = 0;

      for (const c of comps) {
        const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
        if (cx <= f.x0 + 2 || cx >= f.x1 - 2 || cy <= f.y0 + 2 || cy >= f.y1 - 2) continue;
        const ar = Math.max(c.w, c.h) / Math.max(1, Math.min(c.w, c.h));
        if (ar > 1.8) continue;                       /* líneas del campo: nada de blancos alargados */
        if (c.area < expArea * 0.35 || c.area > expArea * 2.6) continue;
        const rad = Math.max(c.w, c.h) / 2;
        const round = rad > 0 ? Math.min(1, c.area / (Math.PI * rad * rad)) : 0;
        const dPrev = exp ? 1 / (1 + Math.hypot(cx - exp.x, cy - exp.y)) : (this.ball ? 1 / (1 + Math.hypot(cx - this.ball.x, cy - this.ball.y)) : 0);
        const s = round + dPrev * 0.5;
        if (s > score) { score = s; best = { x: cx, y: cy }; }
      }
      this.ball = best;
      return best;
    },

    detectPlayers(data, sw, sh, f) {
      const teams = [
        { color: 'red',  mask: (i) => { const p = i * 4; return data[p] >= 140 && data[p + 1] <= 90 && data[p + 2] <= 90 && data[p] - data[p + 2] >= 70; } },
        { color: 'blue', mask: (i) => { const p = i * 4; return data[p + 2] >= 140 && data[p] <= 90 && data[p + 1] <= 90 && data[p + 2] - data[p] >= 70; } }
      ];
      const scale = sw / CFG.worldW;
      const expR = CFG.playerRadius * scale;
      const expArea = Math.PI * expR * expR;
      const out = [];
      for (const t of teams) {
        for (const c of this.components(t.mask, sw, sh)) {
          const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
          if (cx < f.x0 + 2 || cx > f.x1 - 2 || cy < f.y0 + 2 || cy > f.y1 - 2) continue;
          if (c.area < Math.max(7, expArea * 0.3) || c.area > expArea * 2) continue;
          out.push({ x: cx, y: cy, color: t.color });
        }
      }
      this.players = out;
      return out;
    },

    /* MAPEO CORREGIDO: fracción DENTRO del campo * dimensiones de mundo */
    toWorld(p, sw, sh) {
      const f = this.field;
      if (!f) return { x: 0, y: 0 };
      return {
        x: ((p.x - f.x0) / (f.x1 - f.x0)) * CFG.worldW,
        y: ((p.y - f.y0) / (f.y1 - f.y0)) * CFG.worldH
      };
    },

    updateMe() {
      if (this.me && this.me.pinned) return;
      if (!CFG.autoMe || !this.ball || !this.players.length) return;
      let best = null, d = 1e9;
      for (const p of this.players) {
        const dd = Math.hypot(p.x - this.ball.x, p.y - this.ball.y);
        if (dd < d) { d = dd; best = p; }
      }
      if (!best) return;
      if (!this.me) this.me = { x: best.x, y: best.y, color: best.color };
      else {
        const dd = Math.hypot(best.x - this.me.x, best.y - this.me.y);
        if (dd < 50) { this.me.x = best.x; this.me.y = best.y; this.me.color = best.color; }
      }
    },

    analyze(data, sw, sh) {
      this.data = data;
      if (Sampler.isBlank(data)) {
        this.blankFrames++;
        if (this.blankFrames > 8) Host.advance();
        return false;
      }
      this.blankFrames = 0;

      const f = this.detectField(data, sw, sh);
      if (!f) { this.ball = null; this.ballWorld = null; return false; }

      this.players = this.detectPlayers(data, sw, sh, f);
      this.detectBall(data, sw, sh, f);
      if (!this.ball && this.players.length === 0) {
        this.emptyFail++;
        if (this.emptyFail > 9) Host.advance();
        return false;
      }
      this.emptyFail = 0;
      if (!this.ball) { this.ballWorld = null; return false; }

      this.updateMe();

      this.ballWorld = this.toWorld(this.ball, sw, sh);
      if (this.me && !this.me.pinned) this.me.world = this.toWorld(this.me, sw, sh);

      /* Suavizado para el dibujo: menos vibración, mismas físicas de cálculo */
      if (!this.ballSmooth) this.ballSmooth = { x: this.ballWorld.x, y: this.ballWorld.y };
      else {
        const a = 0.5;
        this.ballSmooth.x += a * (this.ballWorld.x - this.ballSmooth.x);
        this.ballSmooth.y += a * (this.ballWorld.y - this.ballSmooth.y);
      }

      this.playersWorld = [];
      for (const p of this.players) {
        const w = this.toWorld(p, sw, sh);
        this.playersWorld.push({ x: p.x, y: p.y, color: p.color, wx: w.x, wy: w.y });
      }
      if (this.me && this.me.world) this.me.world = this.toWorld(this.me, sw, sh);
      return true;
    },

    trackVel(w, dt) {
      if (!w) { this.lastBall = null; return; }
      if (this.lastBall) {
        const dx = w.x - this.lastBall.x, dy = w.y - this.lastBall.y;
        if (dt > 0 && dt < 0.25) { const a = 0.35; this.vx += a * (dx / dt - this.vx); this.vy += a * (dy / dt - this.vy); }
      }
      this.lastBall = { x: w.x, y: w.y };
    },

    demo(t) {
      const s = t * 0.016;
      const cx = 400 + Math.sin(s * 1.1) * 260;
      const cy = 200 + Math.sin(s * 1.9) * 130;
      this.ballWorld = { x: cx, y: cy };
      this.ball = { x: (cx / CFG.worldW) * Sampler.sw, y: (cy / CFG.worldH) * Sampler.sh };
      this.ballSmooth = { x: cx, y: cy };
      this.vx = 260 * Math.cos(s * 1.1);
      this.vy = 170 * Math.cos(s * 1.9);
      this.me = {
        world: { x: 200 + Math.sin(s * 2.3) * 120, y: 120 + Math.cos(s * 2.7) * 60 },
        x: 0, y: 0, color: 'red', pinned: false
      };
      this.playersWorld = [
        { x: 0, y: 0, color: 'red',  wx: 200 + Math.sin(s * 2.3) * 120, wy: 120 + Math.cos(s * 2.7) * 60 },
        { x: 0, y: 0, color: 'blue', wx: 600 + Math.sin(s * 1.7) * 90,  wy: 280 + Math.cos(s * 2.1) * 50 }
      ];
      return true;
    }
  };

  /* ============================================================
     7. MAPPING mundo → pantalla
     ============================================================ */
  function buildMapping() {
    const R = Host.canvasRect();
    const v = Host.viewport();
    const cw = R ? R.width : v.w, ch = R ? R.height : v.h;
    let ox = R ? R.left : 0, oy = R ? R.top : 0;
    let sx = cw / CFG.worldW, sy = ch / CFG.worldH;

    if (Vision.field && Sampler.sw && Sampler.sh) {
      const f = Vision.field;
      const fw = (f.x1 - f.x0) / Sampler.sw, fh = (f.y1 - f.y0) / Sampler.sh;
      const fx = f.x0 / Sampler.sw, fy = f.y0 / Sampler.sh;
      ox = (R ? R.left : 0) + fx * cw;
      oy = (R ? R.top : 0) + fy * ch;
      sx = (fw * cw) / CFG.worldW;
      sy = (fh * ch) / CFG.worldH;
    }
    return { ox, oy, sx, sy };
  }

  function toScreen(M, p) { return { x: M.ox + p.x * M.sx, y: M.oy + p.y * M.sy }; }

  /* ============================================================
     8. PREDICTOR (trayectoria con rebotes y marcador de impacto)
     ============================================================ */
  /* Simula el balón con velocidad estimada: constante decaimiento por
     drag y reflexión en muros hasta N rebotes. Devuelve la polilínea y
     el impacto en el plano del arco (con marca GOAL si entra por la boca). */
  function predict(path) {
    const P = CFG.prediction;
    const W = CFG.worldW, H = CFG.worldH;
    const r = CFG.ballRadius + 0.5;
    const dy = H / 2;                    /* centro de la boca de gol       */
    const goalHalf = GOAL_HALF * 1.15;   /* tolerancia visual              */

    const sp = Math.hypot(path.vx, path.vy);
    if (sp < P.min) return null;

    const out = { pts: [], impact: null };
    const dt = 1 / 72;
    const steps = Math.min(240, Math.ceil(P.time / dt));
    const damp = Math.exp(-P.drag * dt);
    let x = path.x, y = path.y, vx = path.vx, vy = path.vy, bounces = P.bounces;

    for (let i = 0; i < steps; i++) {
      vx *= damp; vy *= damp;
      const crossX = x, crossY = y;
      x += vx * dt; y += vy * dt;

      if (x < r || x > W - r) {
        const tWall = (x < r ? r - crossX : (W - r) - crossX) / Math.max(1e-6, vx);
        const hitY = crossY + vy * tWall;
        out.impact = {
          x: vx < 0 ? 0 : W,
          y: util.clamp(hitY, 0, H),
          on: Math.abs(hitY - dy) <= goalHalf
        };
        if (bounces > 0) { x = x < r ? r : W - r; vx = -vx * P.rest; bounces--; }
        else break;
      }
      if (y < r || y > H - r) {
        if (bounces > 0) { y = y < r ? r : H - r; vy = -vy * P.rest; bounces--; }
        else break;
      }
      out.pts.push({ x, y });
    }
    return out.pts.length ? out : null;
  }

  /* ============================================================
     9. DIBUJO (todo con "glow" multicapa barato)
     ============================================================ */
  const Draw = {
    /* Trazo con brillo multicapa (sin shadowBlur) */
    doStroke(color, width, cfg) {
      const ctx = Overlay.ctx;
      const g = cfg !== false && CFG.style.glow;
      const paint = (W, A) => { ctx.globalAlpha = A; ctx.lineWidth = W; ctx.strokeStyle = color; ctx.stroke(); };
      if (g) { paint(width + 7, 0.09); paint(width + 3, 0.22); }
      ctx.globalAlpha = 1;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    },

    line(A, B, color, width, cfg, dash) {
      const ctx = Overlay.ctx;
      ctx.save();
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      this.doStroke(color, width, cfg);
      ctx.restore();
    },

    poly(pts, color, width, cfg) {
      if (!pts || pts.length < 2) return;
      const ctx = Overlay.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      this.doStroke(color, width, cfg);
      ctx.restore();
    },

    circle(C, rPx, color, width, cfg, fill) {
      const ctx = Overlay.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(C.x, C.y, rPx, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      this.doStroke(color, width, cfg);
      ctx.restore();
    },

    dot(P, rPx, color, fill) {
      const ctx = Overlay.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(P.x, P.y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = fill || color;
      ctx.fill();
      ctx.restore();
    },

    text(txt, P, color, sizePx, bold, align) {
      const ctx = Overlay.ctx;
      ctx.save();
      ctx.font = (bold ? 'bold ' : '') + (sizePx || 12) + 'px "Segoe UI",system-ui,sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = align || 'center';
      ctx.fillText(txt, P.x, P.y);
      ctx.restore();
    },

    xmark(P, size, color, width) {
      const ctx = Overlay.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(P.x - size, P.y - size); ctx.lineTo(P.x + size, P.y + size);
      ctx.moveTo(P.x + size, P.y - size); ctx.lineTo(P.x - size, P.y + size);
      this.doStroke(color, width || 2.5, true);
      ctx.restore();
    },

    /* ---- Decoración del campo (estética neon, solo encima) ---- */
    fieldDecor(M) {
      const th = THEMES[CFG.style.theme] || THEMES.neon;
      const deco = th.deco;
      const W = CFG.worldW, H = CFG.worldH, half = GOAL_HALF;
      const c = (wx, wy) => toScreen(M, { x: wx, y: wy });

      /* bandas de fuera de juego (cercanas a los laterales) */
      this.line(c(12, 0), c(12, H), 'rgba(255,255,255,0.10)', 1.5, false);
      this.line(c(W - 12, 0), c(W - 12, H), 'rgba(255,255,255,0.10)', 1.5, false);

      /* línea de medio campo */
      this.line(c(W / 2, 0), c(W / 2, H), deco, 2, true);
      /* círculo central */
      this.circle(c(W / 2, H / 2), 80 * M.sx, deco, 2, true);
      /* punto central */
      this.dot(c(W / 2, H / 2), 3 * M.sx, deco);

      /* áreas (boxes) */
      const boxD = 95, boxH = 260;
      const c1 = c(0, H / 2 - boxH / 2), c2 = c(boxD, H / 2 + boxH / 2);
      this.line(c1, c(0, H / 2 + boxH / 2), 'rgba(255,255,255,0.35)', 1.5, false);
      this.line(c(0, H / 2 - boxH / 2), c(boxD, H / 2 - boxH / 2), 'rgba(255,255,255,0.35)', 1.5, false);
      this.line(c(boxD, H / 2 - boxH / 2), c2, 'rgba(255,255,255,0.35)', 1.5, false);
      const c3 = c(W, H / 2 - boxH / 2), c4 = c(W - boxD, H / 2 + boxH / 2);
      this.line(c3, c(W, H / 2 + boxH / 2), 'rgba(255,255,255,0.35)', 1.5, false);
      this.line(c(W, H / 2 - boxH / 2), c(W - boxD, H / 2 - boxH / 2), 'rgba(255,255,255,0.35)', 1.5, false);
      this.line(c(W - boxD, H / 2 - boxH / 2), c4, 'rgba(255,255,255,0.35)', 1.5, false);
      void c1; void c2; void c3; void c4;

      /* arcos en las esquinas */
      const R = 26;
      this.circle(c(R, R), R * M.sx, 'rgba(255,255,255,0.30)', 1.5, false);
      this.circle(c(W - R, R), R * M.sx, 'rgba(255,255,255,0.30)', 1.5, false);
      this.circle(c(R, H - R), R * M.sx, 'rgba(255,255,255,0.30)', 1.5, false);
      this.circle(c(W - R, H - R), R * M.sx, 'rgba(255,255,255,0.30)', 1.5, false);

      /* bocas de gol con brillo del tema */
      const gL = th.goal;
      this.line(c(1, H / 2 - half), c(1, H / 2 + half), gL, 3, true);
      this.line(c(W - 1, H / 2 - half), c(W - 1, H / 2 + half), gL, 3, true);
      this.line(c(1, H / 2 - half), c(6, H / 2 - half), gL, 2, true);
      this.line(c(1, H / 2 + half), c(6, H / 2 + half), gL, 2, true);
      this.line(c(W - 1, H / 2 - half), c(W - 6, H / 2 - half), gL, 2, true);
      this.line(c(W - 1, H / 2 + half), c(W - 6, H / 2 + half), gL, 2, true);
    },

    /* ---- Trazos principales ---- */
    render(M, ball, me, ts) {
      const th = THEMES[CFG.style.theme] || THEMES.neon;
      const color = CFG.style.color, w = CFG.style.width;
      const V = CFG.vis;
      const t = ts * 0.001;

      /* 1. decoración de campo debajo de todo */
      if (V.fieldDeco && Vision.field) this.fieldDecor(M);

      const bS = ball ? toScreen(M, ball) : null;

      /* 2. predict: trayectoria larga con rebotes */
      if (V.predict && ball) {
        const pr = predict({ x: ball.x, y: ball.y, vx: Vision.vx, vy: Vision.vy });
        if (pr) {
          const ptsPx = pr.pts.map(p => toScreen(M, p));
          this.poly(ptsPx, 'rgba(255,255,255,0.55)', 2, false);
          if (ptsPx.length >= 2) this.line(ptsPx[0], ptsPx[1], color, 1.6, true, [2, 4]);
          const last = ptsPx[ptsPx.length - 1];
          this.dot(last, 3.5 * M.sx, color);
          if (pr.impact) {
            const imp = toScreen(M, pr.impact);
            if (pr.impact.on) {
              this.circle(imp, 13 * M.sx, th.goal, 3, true, 'rgba(57,255,122,0.14)');
              this.xmark(imp, 7, th.goal, 3);
              this.text('GOAL', { x: imp.x, y: imp.y - 18 * M.sx }, th.goal, Math.max(11, 13 * M.sx), true);
            } else {
              this.dot(imp, 4 * M.sx, 'rgba(255,82,82,0.9)');
            }
          }
        }
      }

      /* 3. balón → arco */
      if (V.lineBallGoal && ball) {
        const gx = ball.x > CFG.worldW / 2 ? 0 : CFG.worldW;
        const gp = toScreen(M, { x: gx, y: CFG.worldH / 2 });
        this.line(bS, gp, color, w, true);
        this.circle(gp, 12, color, 2.5, true);
      }

      /* 4. yo → balón */
      if (V.lineMeBall && me && ball) {
        this.line(toScreen(M, me), bS, '#ffd94d', Math.max(2, w * 0.7), true, [8, 7]);
      }

      /* 5. estela del balón */
      if (V.trail) {
        const hist = known && known.trail ? known.trail : [];
        for (let i = 1; i < hist.length; i++) {
          const a = (i / hist.length);
          const A = toScreen(M, hist[i - 1]), B = toScreen(M, hist[i]);
          this.line(A, B, color, 1 + a * 2.5, false);
        }
      }

      /* 6. radios / aros */
      if (V.radius) {
        if (ball) {
          this.circle(bS, (CFG.ballRadius * CFG.reachMult) * M.sx, color, 2, true, 'rgba(0,255,213,0.05)');
        }
        if (me) {
          const inRange = ball && util.dist(ball, me) <= (CFG.playerRadius + CFG.ballRadius) * 1.25;
          const rPx = (CFG.playerRadius * 1.25) * M.sx;
          this.circle(toScreen(M, me), rPx, inRange ? '#39ff7a' : '#ffd94d', 2, true, inRange ? 'rgba(57,255,122,0.10)' : 'rgba(255,217,77,0.06)');
        }
      }

      /* 7. trayectoria corta (velocidad derivada) */
      if (V.trajectory && ball) {
        const sp = Math.hypot(Vision.vx, Vision.vy);
        if (sp > 4) {
          const ahead = Math.min(90, sp * 0.55);
          const end = { x: ball.x + (Vision.vx / sp) * ahead, y: ball.y + (Vision.vy / sp) * ahead };
          this.line(bS, toScreen(M, end), 'rgba(255,255,255,0.85)', 1.8, true, [4, 5]);
        }
      }

      /* 8. aros de equipo + peligro + crosshair */
      if (V.glowPlayers && Vision.playersWorld) {
        for (const p of Vision.playersWorld) {
          const pp = toScreen(M, p);
          const col = p.color === 'red' ? 'rgba(255,70,70,' : 'rgba(70,130,255,';
          const isMe = me && Math.abs(p.wx - me.x) < 3 && Math.abs(p.wy - me.y) < 3;
          if (isMe) continue;
          this.circle(pp, (CFG.playerRadius * 1.12) * M.sx, col + '0.55)', 2, true, col + '0.06)');
        }
      }

      if (V.danger && me) {
        let opp = null, dT = 1e9;
        if (Vision.playersWorld) {
          for (const p of Vision.playersWorld) {
            if (p.color === me.color) continue;
            const dd = Math.hypot(p.wx - me.x, p.wy - me.y);
            if (dd < dT) { dT = dd; opp = p; }
          }
        }
        if (opp && dT < 55) {
          const pulse = 0.5 + 0.5 * Math.sin(t * 10);
          this.circle(toScreen(M, me), (CFG.playerRadius * (1.4 + pulse * 0.5)) * M.sx, th.warn, 3, true);
          this.text('!', { x: toScreen(M, me).x, y: toScreen(M, me).y - 20 }, th.warn, 15, true);
        }
      }

      /* 9. crosshair sobre "mi" jugador */
      if (V.crosshair && me) {
        const s = toScreen(M, me);
        const g = 10;
        this.line({ x: s.x - g, y: s.y }, { x: s.x - 3, y: s.y }, '#ffffff', 1.8, true);
        this.line({ x: s.x + 3, y: s.y }, { x: s.x + g, y: s.y }, '#ffffff', 1.8, true);
        this.line({ x: s.x, y: s.y - g }, { x: s.x, y: s.y - 3 }, '#ffffff', 1.8, true);
        this.line({ x: s.x, y: s.y + 3 }, { x: s.x, y: s.y + g }, '#ffffff', 1.8, true);
      }

      /* 10. triángulo de "soy yo" + aro */
      if (me) {
        const s = toScreen(M, me);
        const pulse = 0.75 + 0.25 * Math.sin(t * 5);
        this.circle(s, (CFG.playerRadius * (1.1 + pulse * 0.25)) * M.sx, me.color === 'red' ? 'rgba(255,90,90,0.85)' : 'rgba(90,150,255,0.85)', 2.5, true);
        const ctx = Overlay.ctx;
        const ay = s.y - (CFG.playerRadius * 1.8) * M.sx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(s.x, ay - 9);
        ctx.lineTo(s.x - 6, ay);
        ctx.lineTo(s.x + 6, ay);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
      }

      /* 11. HUD compacto */
      if (V.hud && ball) {
        const sp = Math.hypot(Vision.vx, Vision.vy);
        const goalX = ball.x > CFG.worldW / 2 ? CFG.worldW : 0;
        const dGoal = util.dist(ball, { x: goalX, y: CFG.worldH / 2 });
        const tGoal = sp > 8 ? dGoal / sp : 0;
        const lblB = 'BALÓN ' + Math.round(sp) + ' u/s';
        const lblG = '→ gol ' + (sp > 8 ? tGoal.toFixed(1) + 's' : '—');
        const lblM = me ? ' · yo→balón ' + Math.round(util.dist(ball, me)) + ' u' : '';
        const px = Math.min(Overlay.w * 0.5, Math.max(140, Overlay.w - 320));
        const y = 26;
        const th2 = THEMES[CFG.style.theme] || THEMES.neon;
        this.text(lblB + lblG + lblM, { x: px, y: y }, '#ffffff', 12, true);
        this.text(lblM ? '' : lblM, { x: px, y: y + 14 }, th2.deco, 10, false);
        this.text(Perf.modeLabel(), { x: Overlay.w - 70, y: 26 }, 'rgba(160,160,160,0.7)', 10, false);
      }
    }
  };

  /* ============================================================
     10. MENÚ (generado desde lista, con temas y toggles nuevos)
     ============================================================ */
  const MENU_ITEMS = [
    ['lineBallGoal', 'Línea balón → arco'],
    ['lineMeBall',   'Línea yo → balón'],
    ['radius',       'Radio de alcance'],
    ['trajectory',   'Trayectoria corta'],
    ['predict',      'Predicción + rebotes'],
    ['trail',        'Estela del balón'],
    ['hud',          'HUD velocidad / gol'],
    ['danger',       'Alerta de peligro'],
    ['fieldDeco',    'Decoración de campo'],
    ['crosshair',    'Crosshair propio'],
    ['glowPlayers',  'Aros de equipo'],
    ['demo',         'Demo (sin campo)']
  ];

  const Menu = {
    el: null, open: false, lastStatus: 0,

    build() {
      if (this.el && this.el.isConnected) {
        if (Date.now() - this.lastStatus > 300) { this.lastStatus = Date.now(); this.updateStatus(); }
        return;
      }
      this.el = Host.doc.createElement('div');
      this.el.style.cssText =
        'position:fixed;top:10px;right:10px;z-index:2147482601;font:12px/1.5 "Segoe UI",system-ui,sans-serif;color:#dff6f1;user-select:none;pointer-events:auto';

      const cols = Object.keys(THEMES).map(th =>
        '<span data-opm="theme" data-t="' + th + '" title="Tema ' + th + '" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:' + THEMES[th].deco + ';cursor:pointer;border:2px solid ' + (th === CFG.style.theme ? '#fff' : '#0000') + '"></span>').join('');

      const cbs = MENU_ITEMS.map(m =>
        '<label style="display:flex;gap:8px;margin:3px 0;cursor:pointer"><input data-opm="cb" type="checkbox" data-k="' + m[0] + '"> ' + m[1] + '</label>').join('');

      this.el.innerHTML = `
        <div>
          <button data-opm="toggle" style="cursor:pointer;background:#0a121ade;border:1px solid #00ffd566;color:#00ffd5;border-radius:8px;padding:6px 10px;font-weight:700;letter-spacing:1px">🎯 OP · M</button>
        </div>
        <div data-opm="panel" style="display:none;margin-top:6px;width:262px;background:#0a121af2;border:1px solid #00ffd544;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px #0009;max-height:82vh;overflow:auto">
          <div data-opm="status" style="margin-bottom:8px;font-size:11px;color:#9be8d8;line-height:1.55"></div>
          ${cbs}
          <label style="display:block;margin:6px 0 2px;color:#9be8d8"><input data-opm="cb" type="checkbox" data-k="autoMe"> "Yo" automático</label>
          <label style="display:block;margin:8px 0 2px;color:#9be8d8">Grosor
            <input data-opm="range" type="range" min="1" max="10" value="${CFG.style.width}" style="width:100%"></label>
          <label style="display:block;margin:4px 0 2px;color:#9be8d8"><input data-opm="cb" type="checkbox" data-k="opmask"> Brillo neon</label>
          <div style="display:flex;gap:6px;margin:8px 0">
            ${['#00ffd5', '#ffd94d', '#ff5252', '#4d79ff', '#b24dff', '#ffffff'].map(c =>
              '<span data-opm="col" data-c="' + c + '" style="display:inline-block;width:20px;height:20px;border-radius:50%;background:' + c + ';cursor:pointer;border:2px solid ' + (c === CFG.style.color ? '#fff' : '#0000') + '"></span>').join('')}
          </div>
          <div style="color:#9be8d8;margin:6px 0 3px">Temas de campo (decorado)</div>
          <div style="display:flex;gap:6px;margin-bottom:8px">${cols}</div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button data-opm="pick" style="flex:1;cursor:pointer;background:#ffd94d22;border:1px solid #ffd94d88;color:#ffd94d;border-radius:6px;padding:5px">🎯 Soy yo</button>
            <button data-opm="autome" style="flex:1;cursor:pointer;background:#00ffd522;border:1px solid #00ffd588;color:#00ffd5;border-radius:6px;padding:5px">♻ Auto yo</button>
            <button data-opm="kill" style="flex:1;cursor:pointer;background:#ff525222;border:1px solid #ff525288;color:#ff5252;border-radius:6px;padding:5px">✖</button>
          </div>
        </div>`;
      Host.doc.body.appendChild(this.el);

      this.el.querySelector('[data-opm="toggle"]').onclick = () => this.setOpen(!this.open);

      this.el.querySelectorAll('[data-opm="cb"]').forEach(cb => {
        const k = cb.dataset.k;
        cb.checked = k === 'autoMe' ? !!CFG.autoMe : (k === 'opmask' ? CFG.style.glow : !!CFG.vis[k]);
        cb.onchange = () => {
          if (k === 'autoMe') { CFG.autoMe = cb.checked; if (cb.checked) restartAuto(); }
          else if (k === 'opmask') { CFG.style.glow = cb.checked; }
          else { CFG.vis[k] = cb.checked; }
          persist();
        };
      });

      this.el.querySelector('[data-opm="range"]').oninput = (e) => { CFG.style.width = +e.target.value; persist(); };

      this.el.querySelectorAll('[data-opm="col"]').forEach(s => {
        s.onclick = () => {
          CFG.style.color = s.dataset.c;
          this.el.querySelectorAll('[data-opm="col"]').forEach(x => x.style.borderColor = x === s ? '#fff' : '#0000');
          persist();
        };
      });

      this.el.querySelectorAll('[data-opm="theme"]').forEach(s => {
        s.onclick = () => {
          CFG.style.theme = s.dataset.t;
          this.el.querySelectorAll('[data-opm="theme"]').forEach(x => x.style.borderColor = x === s ? '#fff' : '#0000');
          persist();
          util.log('Tema de campo: ' + CFG.style.theme);
        };
      });

      this.el.querySelector('[data-opm="pick"]').onclick = () => startPick();
      this.el.querySelector('[data-opm="autome"]').onclick = () => restartAuto();
      this.el.querySelector('[data-opm="kill"]').onclick = () => OpMode.destroy();

      this.lastStatus = Date.now();
      this.updateStatus();
    },

    setOpen(v) {
      this.open = v;
      const p = this.el && this.el.querySelector('[data-opm="panel"]');
      const b = this.el && this.el.querySelector('[data-opm="toggle"]');
      if (p) p.style.display = v ? 'block' : 'none';
      if (b) b.textContent = v ? '▾ OP · M' : '🎯 OP · M';
    },

    updateStatus() {
      const n = this.el && this.el.querySelector('[data-opm="status"]');
      if (!n) return;
      const src = Data.custom ? 'CUSTOM' : (Vision.field ? 'PÍXELES' : 'NONE');
      const f = Vision.field ? 'campo ✓' : 'campo ✗';
      const b = known && known.ball ? 'balón ✓' : 'balón ✗';
      const m = meNow() ? 'yo ✓' : 'yo ✗';
      const extra = (Vision.field && !Host.canvasRect()) ? ' · (letterbox)' : '';
      n.textContent = src + ' · ' + f + ' · ' + b + ' · ' + m + ' · ' + Perf.modeLabel() + extra + '\nhold 500ms · M menú';
    },

    statusNow() { this.lastStatus = 0; }
  };

  /* "yo": obtener el actual (world) */
  function meNow() {
    const m = Vision.me;
    return m && m.world ? m.world : null;
  }

  function restartAuto() {
    Vision.me = null; CFG.autoMe = true; persist();
    const el = Menu.el && Menu.el.querySelector('[data-opm="cb"][data-k="autoMe"]');
    if (el) el.checked = true;
    util.log('"Yo" en automático (jugador más cercano al balón).');
  }

  /* Fijar "yo" con clic sobre tu avatar */
  function startPick() {
    picking = true;
    Menu.setOpen(false);
    Overlay.ensure();
    Overlay.canvas.style.pointerEvents = 'auto';
    util.log('Haz clic sobre tu jugador.');
  }
  let picking = false;

  function onPickClick(e) {
    if (!picking) return;
    picking = false;
    Overlay.canvas.style.pointerEvents = 'none';
    const M = buildMapping();
    const w = util.clamp((e.clientX - M.ox) / M.sx, 0, CFG.worldW);
    const h = util.clamp((e.clientY - M.oy) / M.sy, 0, CFG.worldH);
    Vision.me = { world: { x: w, y: h }, pinned: true, color: 'red' };
    CFG.autoMe = false;
    persist();
    const cb = Menu.el && Menu.el.querySelector('[data-opm="cb"][data-k="autoMe"]');
    if (cb) cb.checked = false;
    util.log('"Yo" fijado en (' + w.toFixed(0) + ', ' + h.toFixed(0) + '). Pulsa ♻ Auto yo para desfijarlo.');
  }

  /* ============================================================
     11. FUENTE DE DATOS POR API (opcional)
     ============================================================ */
  const Data = { custom: null, ball: null, me: null, players: [] };

  function pollCustom() {
    if (typeof Data.custom !== 'function') return false;
    try {
      const d = Data.custom();
      if (d && d.ball && (d.ball.x != null)) {
        Data.ball = { x: d.ball.x, y: d.ball.y };
        if (d.me) Data.me = { world: { x: d.me.x, y: d.me.y }, color: d.me.team === 1 ? 'red' : 'blue', pinned: true };
        Data.players = Array.isArray(d.players) ? d.players.map(p => ({
          wx: p.x, wy: p.y, color: p.team === 1 ? 'red' : 'blue', x: 0, y: 0
        })) : [];
        if (Data.players.length) Vision.playersWorld = Data.players;
        if (!d.me && Data.players.length) {
          Data.me = { world: { x: Data.players[0].wx, y: Data.players[0].wy }, color: Data.players[0].color, pinned: true };
        }
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ============================================================
     12. ATAJOS + BUCLE
     ============================================================ */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const K = CFG.keys;
    const toggle = (k, label) => {
      CFG.vis[k] = !CFG.vis[k]; persist();
      const el = Menu.el && Menu.el.querySelector('[data-opm="cb"][data-k="' + k + '"]');
      if (el) el.checked = CFG.vis[k];
      Menu.statusNow();
      util.log(label + ' → ' + (CFG.vis[k] ? 'ON' : 'OFF'));
    };
    switch (e.code) {
      case K.menu: Menu.setOpen(!Menu.open); break;
      case K.lbg: toggle('lineBallGoal', 'Línea balón→arco'); break;
      case K.lmb: toggle('lineMeBall', 'Línea yo→balón'); break;
      case K.radius: toggle('radius', 'Radio de alcance'); break;
      case K.traj: toggle('trajectory', 'Trayectoria corta'); break;
      case K.predict: toggle('predict', 'Predicción'); break;
      case K.trail: toggle('trail', 'Estela'); break;
      case K.hud: toggle('hud', 'HUD'); break;
      case K.danger: toggle('danger', 'Peligro'); break;
      case K.field: toggle('fieldDeco', 'Decoración de campo'); break;
      case K.cross: toggle('crosshair', 'Crosshair'); break;
      case K.glow: toggle('glowPlayers', 'Aros de equipo'); break;
      case K.overlay:
        CFG.vis.overlay = !CFG.vis.overlay; persist();
        Menu.statusNow();
        util.log('Overlay ' + (CFG.vis.overlay ? 'visible' : 'oculto'));
        break;
    }
  }

  let lastTs = 0, tick = 0, demoTick = 0;
  let known = null;          /* última detección para dibujo continuo */

  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    tick++;
    demoTick++;

    try {
      Host.scan();
      BuildMenuThrottled();
      Overlay.ensure();

      const hidden = Host.doc.hidden === true;

      /* ¿Hace falta leer el canvas? Solo si: overlay visible, sin fuente
         custom, hay canvas y la pestaña está visible. */
      const wantPixels = CFG.vis.overlay && !Data.custom && !hidden && !!Host.canvas;

      if (wantPixels && tick % Perf.tick === 0) {
        Perf.begin();
        const data = Sampler.frame();
        if (data) {
          const ok = Vision.analyze(data, Sampler.sw, Sampler.sh);
          if (ok) {
            Vision.trackVel(Vision.ballWorld, dt);
            recordKnown(ts);
          } else if (known && ts - known.t > CFG.holdMs * 3) {
            known = null;
          }
        }
        Perf.end();
      }

      const M = buildMapping();

      /* Fuente: custom > píxeles > demo */
      let ball = null, me = null;
      if (pollCustom()) {
        ball = Data.ball;
        Vision.trackVel(ball, dt);
        me = Data.me && Data.me.world ? Data.me.world : meNow();
      } else if (known && ts - known.t <= CFG.holdMs) {
        ball = known.ball;
        me = known.me;
      }

      if (!ball && CFG.vis.demo) {
        Vision.demo(demoTick);
        ball = Vision.ballWorld;
        me = meNow() || Vision.me.world || null;
        recordKnown(ts);
      }

      if (CFG.vis.overlay) {
        Overlay.sync();
        Draw.render(M, ball, me, ts);
      }
    } catch (e) {}
  }

  /* Builder de menú throttled (evita tocar el DOM por frame) */
  let _lastMenuBuild = 0;
  function BuildMenuThrottled() {
    if (Date.now() - _lastMenuBuild < 300) return;
    _lastMenuBuild = Date.now();
    try { Menu.build(); } catch (e) {}
  }

  /* Guardar la detección actual + estela (para hold y trail) */
  function recordKnown(ts) {
    const m = meNow() || (Vision.me && Vision.me.world) || null;
    const prev = known ? known.ball : null;
    known = {
      ball: Vision.ballSmooth ? { x: Vision.ballSmooth.x, y: Vision.ballSmooth.y } : (Vision.ballWorld ? { x: Vision.ballWorld.x, y: Vision.ballWorld.y } : null),
      me: m ? { x: m.x, y: m.y } : null,
      t: ts
    };
    if (prev && known.ball && CFG.vis.trail) {
      known.trail = (known.trail || prev.trail || []).concat([known.ball]);
      if (known.trail.length > CFG.trail.len) known.trail = known.trail.slice(-CFG.trail.len);
    } else if (known.ball) known.trail = [known.ball];
  }

  /* ============================================================
     13. API PÚBLICA
     ============================================================ */
  const OpMode = {
    _opmode: true,
    get version() { return CFG.version; },

    get state() {
      return {
        source: Data.custom ? 'custom' : (Vision.field ? 'pixels' : 'none'),
        ball: Data.custom ? Data.ball : (known && known.ball ? known.ball : null),
        me: (Data.custom && Data.me) ? Data.me.world : meNow(),
        players: (Vision.playersWorld || []).map(p => ({ x: p.wx, y: p.wy, color: p.color })),
        ballSpeed: Math.round(Math.hypot(Vision.vx, Vision.vy)),
        field: !!Vision.field,
        perf: Perf.modeLabel(),
        vis: Object.assign({}, CFG.vis)
      };
    },

    toggle(what) {
      const toggles = ['lineBallGoal', 'lineMeBall', 'radius', 'trajectory', 'predict', 'trail', 'hud', 'danger', 'fieldDeco', 'crosshair', 'glowPlayers', 'demo', 'overlay'];
      if (toggles.indexOf(what) >= 0) {
        CFG.vis[what] = !CFG.vis[what]; persist();
        util.log(what + ' → ' + (CFG.vis[what] ? 'ON' : 'OFF'));
      } else util.log('Opciones: ' + toggles.join(', '));
    },

    setMe(x, y) {
      if (typeof x === 'object' && x != null) { y = x.y; x = x.x; }
      if (!isFinite(x) || !isFinite(y)) return util.log('Uso: OpMode.setMe(x, y)');
      Vision.me = { world: { x: util.clamp(x, 0, CFG.worldW), y: util.clamp(y, 0, CFG.worldH) }, pinned: true, color: 'red' };
      CFG.autoMe = false; persist();
      Menu.statusNow();
      util.log('"Yo" = (' + x.toFixed(0) + ', ' + y.toFixed(0) + ')');
    },

    setBall(x, y) {
      if (typeof x === 'object' && x != null) { y = x.y; x = x.x; }
      if (isFinite(x) && isFinite(y)) { Data.ball = { x, y }; util.log('Balón override  (' + x.toFixed(0) + ', ' + y.toFixed(0) + ')'); }
    },

    setPlayers(list) {
      if (Array.isArray(list)) {
        Vision.playersWorld = list.map(p => ({
          wx: p.x, wy: p.y, color: p.team === 1 ? 'red' : 'blue', x: 0, y: 0
        }));
      }
    },

    pickMe() { startPick(); },

    resetMe() { restartAuto(); },

    setTheme(name) {
      if (THEMES[name]) {
        CFG.style.theme = name; persist();
        const el = Menu.el && Menu.el.querySelector('[data-opm="theme"][data-t="' + name + '"]');
        if (el) Menu.el.querySelectorAll('[data-opm="theme"]').forEach(x => x.style.borderColor = x === el ? '#fff' : '#0000');
        util.log('Tema: ' + name);
      } else util.log('Temas: ' + Object.keys(THEMES).join(', '));
    },

    nextTheme() {
      const names = Object.keys(THEMES);
      const i = names.indexOf(CFG.style.theme);
      this.setTheme(names[(i + 1) % names.length]);
    },

    setDataSource(fn) {
      Data.custom = typeof fn === 'function' ? fn : null;
      util.log(Data.custom ? 'Fuente custom activada.' : 'Vuelta a detección por píxeles.');
    },

    destroy() {
      cancelAnimationFrame(loop);
      Host.doc.removeEventListener('keydown', onKey, false);
      Host.doc.removeEventListener('click', onPickClick, true);
      Overlay.remove();
      if (Menu.el && Menu.el.parentNode) Menu.el.parentNode.removeChild(Menu.el);
      Menu.el = null;
      if (window.OpMode === OpMode) delete window.OpMode;
      util.log('Apagado. F5 para un reinicio limpio.');
    },

    help() {
      console.log('%cM menú · N balón→arco · J yo→balón · B radio · V trayectoria · P predicción\nT estela · U HUD · D peligro · G campo · C crosshair · H aros · K overlay\n\nOpMode.toggle(...), setMe, setBall, setPlayers, pickMe, resetMe\nOpMode.setTheme(name), nextTheme, setDataSource(fn), state, destroy',
        'color:#9be8d8;font:12px/1.6 monospace');
    }
  };

  /* ============================================================
     ARRANQUE
     ============================================================ */
  loadCfg();
  Host.init();
  Overlay.ensure();
  BuildMenuThrottled();
  Host.doc.addEventListener('keydown', onKey, false);
  Host.doc.addEventListener('click', onPickClick, true);
  window.OpMode = OpMode;
  requestAnimationFrame(loop);

  util.log('v' + CFG.version + ' activado. M: menú · K: overlay · P: predicción · U: HUD');
  util.log('Rendimiento adaptativo: ' + Perf.modeLabel() + ' (+N/M ajustan)');
  util.log('Si no ves nada aún (lobby/cargando): pulsa M y activa "Demo".');
})();