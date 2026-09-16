/* ======================================================================
   OpMode · Haxball Client Assistant   ·   v2.0.0
   ----------------------------------------------------------------------
   Script 100% cliente para pegar en la consola DevTools (F12) dentro de
   https://www.haxball.com/play

   v2.0.0 (IMPORTANTE): el cliente oficial NO expone ninguna API de
   posiciones. Por eso ahora la detección principal es POR PÍXELES: se lee
   el canvas del juego (hook sobre el requestAnimationFrame del iframe +
   gl.readPixels), se detectan el campo (rectángulo verde), el balón
   (blanco) y los jugadores (siluetas rojas/azules), y se dibujan encima:

     - Menú desplegable tipo "mod menu" (esquina superior derecha)
     - Línea balón → arco rival (la más lejana al balón)
     - Línea yo → balón (con "yo" fijado a mano o auto: el más cercano)
     - Radio de alcance / contacto alrededor del balón y de tu jugador
     - Trayectoria estimada del balón (velocidad derivada por píxeles)
     - Modo demo animado (para ver las líneas funcionando en el lobby)
     - Fuente de datos opcional por API (Room / g / setDataSource)

   Atajos:
     M  ... abrir / cerrar el menú
     N  ... línea balón → arco
     J  ... línea yo → balón
     B  ... radio de alcance (círculos)
     V  ... trayectoria del balón
     K  ... mostrar / ocultar todo el overlay

   API en consola: window.OpMode  (ver sección 12)
   ====================================================================== */
(() => {
  'use strict';

  /* Ya hay una instancia activa */
  if (window.OpMode && window.OpMode._opmode) {
    console.warn('[OpMode] Ya hay una instancia activa. Escribe OpMode.destroy() y vuelve a pegar.');
    return;
  }

  /* ================ 1. CONFIGURACIÓN ================ */
  const DEFAULTS = {
    version: '2.0.0',

    /* Dimensiones del campo en "unidades del mundo" (estadio estándar) */
    worldW: 800,
    worldH: 400,

    /* Radios físicos por defecto */
    ballRadius: 10,
    playerRadius: 15,

    /* Multiplicador del radio de alcance dibujado (qué tan lejos del balón
       un jugador lo "alcanza"). Se pinta un círculo de este radio alrededor
       del balón y otro alrededor de "yo" cuando lo tiene cercano. */
    reachMult: 1.6,

    /* Toggles de ayudas (persistidos en localStorage) */
    vis: {
      lineBallGoal: true,   /* línea balón → arco rival       */
      lineMeBall: true,     /* línea yo → balón               */
      radius: true,         /* radios de alcance              */
      trajectory: true,     /* trayectoria estimada del balón */
      demo: true,           /* demo animada si no hay campo   */
      overlay: true         /* muestra todo (K)               */
    },

    /* Estilo de las líneas (persistido) */
    style: {
      color: '#00ffd5',   /* color de asistencia (neón) */
      width: 4            /* grosor en px               */
    },

    /* Auto-identificación de "yo": el jugador más cercano al balón */
    autoMe: true,

    /* Ancho objetivo del buffer de análisis (px). Más grande = más
       precisión, más coste. */
    sampleWTarget: 360,

    /* Frecuencia del análisis de píxeles (nº de frames del hook entre
       lecturas; 1 = cada frame del juego) */
    glEvery: 1,

    keys: { menu: 'KeyM', lineBallGoal: 'KeyN', lineMeBall: 'KeyJ',
            radius: 'KeyB', trajectory: 'KeyV', overlay: 'KeyK' }
  };

  let CFG = {};  // se fusiona con DEFAULTS + localStorage en init()

  const util = {
    styleInfo: 'color:#00ffd5;font-weight:bold;background:#0a121a;padding:2px 6px;border-radius:3px',
    log(msg) { console.log('%c[OPMODE] ' + msg, this.styleInfo); },
    clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
    dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
    /* Canvas >= 40k px de área, el más grande = el escenario */
    bestCanvas(doc) {
      try {
        let best = null, bestArea = 0;
        for (const c of doc.querySelectorAll('canvas')) {
          const r = c.getBoundingClientRect();
          const a = r.width * r.height;
          if (a >= 40000 && a > bestArea) { bestArea = a; best = c; }
        }
        return best;
      } catch (e) { return null; }
    }
  };

  /* ================ 2. LOCALIZAR IFRAME / CANVAS ================ */
  const Loc = {
    iframe: null,      /* <iframe> del juego (game.html) */
    win: null,         /* window del iframe              */
    doc: null,         /* document del iframe            */
    canvas: null,      /* <canvas> del escenario         */
    rect: null,        /* getBoundingClientRect() fresca */
    lastScan: 0,

    find() {
      /* Buscar el iframe que contiene el canvas grande */
      try {
        for (const f of document.querySelectorAll('iframe')) {
          const d = f.contentDocument;
          if (!d) continue;
          if (util.bestCanvas(d)) { this.iframe = f; return; }
        }
      } catch (e) { /* cross-origin: ignorar */ }

      /* Fallback: el iframe .gameframe por nombre de clase */
      const gf = document.querySelector('iframe.gameframe, .gameframe iframe, iframe[src*="game.html"]');
      if (gf) this.iframe = gf;
    },

    canvasRect() {
      if (this.canvas && this.canvas.isConnected) {
        const r = this.canvas.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) { this.rect = r; return r; }
      }
      return this.rect;
    },

    update() {
      const now = Date.now();
      if (now - this.lastScan < 600 && this.canvas && this.canvas.isConnected) return;
      this.lastScan = now;

      if (!this.iframe || !this.iframe.isConnected) this.find();
      if (!this.iframe) return;

      try {
        const w = this.iframe.contentWindow;
        const d = this.iframe.contentDocument;
        if (!w || !d) return;
        this.win = w; this.doc = d;
        const c = util.bestCanvas(d);
        if (c !== this.canvas) {
          if (this.canvas) Overlay.cleanupCanvas(this.canvas);
          this.canvas = c || null;
          if (c) Overlay.bindCanvas(c);
        }
      } catch (e) { /* iframe en reparación */ }
    }
  };

  /* ================ 3. LECTURA DE PÍXELES (hook en el iframe) ================
     El juego renderiza con WebGL y SE BORRA el drawing buffer al componer la
     página (preserveDrawingBuffer=false), por lo que NUNCA se puede leer por
     getImageData/drawImage desde fuera. La técnica que SÍ funciona:

       1. Envolvemos requestAnimationFrame del iframe UNA vez.
       2. Nuestro callback se registra DESPUÉS del del juego (FIFO), así que se
          ejecuta justo después de que el juego dibuje y ANTES de que el
          navegador limpie/componga el buffer.
       3. Ahí llamamos gl.readPixels (buffer todavía válido) y bajamos la
          resolución a una cuadrícula pequeña (≈360 px de ancho) que dejamos
          listo en iframe.__opmode_pix para que el documento padre lo use.

     Si no hay contexto WebGL (fallback raro), se usa drawImage → canvas 2D.
  */
  const Sampler = {
    mode: 'none',         /* 'gl-hook' | '2d' */
    enabled: false,
    buf: null,            // Uint8ClampedArray RGBA del downsample
    sw: 0, sh: 0,         // dimensiones del downsample
    glCtx: null,
    glBuf: null,          // buffer completo readPixels (persistente)
    fullW: 0, fullH: 0,
    step: 1,
    hooked: false,
    tries2d: 0,

    /* Envolver rAF del iframe (una sola vez) */
    hook(win) {
      if (win.__opmode_hooked) return;
      win.__opmode_hooked = true;
      const origRaf = win.requestAnimationFrame.bind(win);
      const tag = '__opmode_pix';
      const self = this;
      const stepFn = () => {
        if (!self.enabled) { win[tag] = null; return; }   /* ya apagado */
        try { self.readFrame(win, tag); } catch (e) { /* frame fallido */ }
        origRaf(stepFn);
      };
      try { origRaf(stepFn); } catch (e) { /* window cerrado */ }
    },

    /* Leer un frame desde el gancho */
    readFrame(win, tag) {
      const c = Loc.canvas;
      if (!c) return;
      const w = c.width, h = c.height;
      if (!w || !h || w * h > 40e6) return;

      /* ---- vía WebGL readPixels ---- */
      if (this.mode === 'gl-hook') {
        if (!this.glCtx || c.__opmode_gl_broken) {
          const ctx = this.getGL(c);
          if (ctx) { this.glCtx = ctx; c.__opmode_gl_broken = false; }
          else { c.__opmode_gl_broken = true; this.mode = '2d'; return; }
        }
        if (!this.glBuf || this.fullW !== w || this.fullH !== h) {
          this.fullW = w; this.fullH = h;
          this.glBuf = new Uint8Array(w * h * 4);
        }
        try {
          this.glCtx.readPixels(0, 0, w, h, this.glCtx.RGBA, this.glCtx.UNSIGNED_BYTE, this.glBuf);
        } catch (e) { return; }
        this.downsampleFromGL(win, tag, w, h);
        return;
      }

      /* ---- vía canvas 2D (fallback) ---- */
      if (this.mode === '2d') {
        if (c.__opmode_2d_broken) return;
        try {
          if (!this.off) {
            this.off = document.createElement('canvas');
            this.off.style.cssText = 'position:absolute;left:-99999px;top:0;width:2px;height:2px;visibility:hidden;pointer-events:none';
            this.offCtx = this.off.getContext('2d');
            document.body.appendChild(this.off);
          }
          this.off.width = this.targetSampleW(w);
          this.off.height = Math.max(1, Math.round(this.off.width * h / w));
          this.offCtx.drawImage(c, 0, 0, this.off.width, this.off.height);
          const img = this.offCtx.getImageData(0, 0, this.off.width, this.off.height);
          let any = 0;
          const d = img.data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { any = 1; break; }
          if (!any) { if (this.tries2d++ < 12) return; this.off.style.display = 'none'; c.__opmode_2d_broken = true; return; }
          this.tries2d = 0;
          win[tag] = { w: this.off.width, h: this.off.height, data: d, t: performance.now() };
        } catch (e) { c.__opmode_2d_broken = true; }
      }
    },

    getGL(c) {
      for (const kind of ['webgl2', 'webgl', 'experimental-webgl']) {
        try {
          const ctx = c.getContext(kind, { willReadFrequently: true });
          if (ctx && (typeof ctx.readPixels === 'function')) return ctx;
        } catch (e) { /* siguiente */ }
      }
      return null;
    },

    targetSampleW(fullW) {
      const w = Math.min(CFG.sampleWTarget, fullW);
      this.step = Math.max(1, Math.round(fullW / w));
      return Math.floor(fullW / this.step);
    },

    downsampleFromGL(win, tag, w, h) {
      const sw = this.targetSampleW(w);
      const sh = Math.max(1, Math.round(h / this.step));
      if (!this.buf || this.sw !== sw || this.sh !== sh) {
        this.sw = sw; this.sh = sh;
        this.buf = new Uint8ClampedArray(sw * sh * 4);
      }
      const src = this.glBuf, dst = this.buf;
      const s = this.step;
      let o = 0;
      for (let sy = 0; sy < sh; sy++) {
        const srcY = (h - 1) - (sy * s + (s >> 1));   // readPixels es bottom-up
        if (srcY < 0 || srcY >= h) { o += sw * 4; continue; }
        let srcRow = srcY * w;
        for (let sx = 0; sx < sw; sx++) {
          const p = (srcRow + sx * s + (s >> 1)) * 4;
          dst[o++] = src[p]; dst[o++] = src[p + 1]; dst[o++] = src[p + 2]; dst[o++] = src[p + 3];
        }
      }
      win[tag] = { w: sw, h: sh, data: dst, t: performance.now(), age: 0 };
    },

    init() {
      if (this.hooked) return;
      const w = Loc.win;
      if (!w) return;
      const c = Loc.canvas;
      if (!c) return;

      this.enabled = true;

      /* Decidir modo: preferimos GL si hay contexto */
      const ctx = this.getGL(c);
      if (ctx) { this.mode = 'gl-hook'; this.glCtx = ctx; }
      else { this.mode = '2d'; }
      this.hooked = true;
      this.hook(w);
      util.log('Lectura por píxeles: ' + (this.mode === 'gl-hook' ? 'WebGL readPixels (en tiempo real)' : 'canvas 2D'));
    }
  };

  /* ================ 4. OVERLAY (canvas propio fullscreen) ================ */
  const Overlay = {
    canvas: null,
    ctx: null,
    cssW: 0, cssH: 0,
    picking: false,       /* modo "elige tu jugador con un clic" */
    onPick: null,
    attachedCanvas: null,

    create() {
      if (this.canvas) this.remove();
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('data-opmode', '1');
      this.canvas.style.position = 'fixed';
      this.canvas.style.left = '0';
      this.canvas.style.top = '0';
      this.canvas.style.zIndex = '2147482600';
      this.canvas.style.pointerEvents = 'none';
      document.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
    },

    bindCanvas(c) {
      this.attachedCanvas = c;
    },

    cleanupCanvas(c) {
      if (c) { c.__opmode_gl_broken = false; c.__opmode_2d_broken = false; }
    },

    remove() {
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null; this.ctx = null;
      if (this.attachedCanvas) this.cleanupCanvas(this.attachedCanvas);
      this.attachedCanvas = null;
    },

    sync() {
      if (!this.canvas) this.create();
      const vw = window.innerWidth, vh = window.innerHeight;
      if (!vw || !vh) return;
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(vw * dpr), ph = Math.round(vh * dpr);
      if (this.canvas.width !== pw) this.canvas.width = pw;
      if (this.canvas.height !== ph) this.canvas.height = ph;
      this.cssW = vw; this.cssH = vh;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, vw, vh);
    }
  };

  /* ================ 5. VISIÓN (análisis de píxeles) ================ */
  const Vision = {
    pix: null,              // {w,h,data} del iframe
    field: null,            // {x0,y0,x1,y1} en coords del downsample
    ball: null,             // {x,y} en coords del downsample
    ballWorld: null,
    players: [],            // [{x,y,color}] sample
    me: null,               // {x,y,color,world}
    demo: null,             // dibujo sintético

    /* --- rectángulo del campo: píxeles verdes dominantes --- */
    detectField(px) {
      let sx0 = 1e9, sy0 = 1e9, sx1 = -1, sy1 = -1, count = 0;
      const d = px.data, w = px.w, h = px.h;
      for (let y = 0; y < h; y += 2) {
        const row = y * w * 4;
        for (let x = 0; x < w; x += 2) {
          const p = row + x * 4;
          const r = d[p], g = d[p + 1], b = d[p + 2];
          if (g >= 60 && g <= 240 && g >= r + 25 && g >= b + 25) {
            if (x < sx0) sx0 = x; if (x > sx1) sx1 = x;
            if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
            count++;
          }
        }
      }
      if (count < 100) return null;               // sin campo suficiente
      const f = { x0: sx0, y0: sy0, x1: sx1, y1: sy1 };
      if (!this.field) { this.field = f; return f; }
      /* suavizado para evitar parpadeo página a página */
      const a = 0.12;
      this.field.x0 += a * (f.x0 - this.field.x0);
      this.field.y0 += a * (f.y0 - this.field.y0);
      this.field.x1 += a * (f.x1 - this.field.x1);
      this.field.y1 += a * (f.y1 - this.field.y1);
      return this.field;
    },

    /* --- componentes conexas sobre una máscara booleana --- */
    components(px, isHot) {
      const w = px.w, h = px.h, d = px.data;
      const seen = new Uint8Array(w * h);
      const out = [];
      for (let y = 1; y < h - 1; y++) {
        const row = y * w;
        for (let x = 1; x < w - 1; x++) {
          const i = row + x;
          if (seen[i]) continue;
          if (!isHot(d, i * 4)) continue;
          /* BFS/DFS por pila sobre vecinos 4-conectados */
          const stack = [i];
          let minX = x, maxX = x, minY = y, maxY = y, sumX = 0, sumY = 0, n = 0;
          seen[i] = 1;
          while (stack.length) {
            const c = stack.pop();
            const cx = c % w, cy = (c - cx) / w;
            sumX += cx + 0.5; sumY += cy + 0.5; n++;
            if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
            for (const nb of [c - 1, c + 1, c - w, c + w]) {
              if (nb < 0 || nb >= seen.length) continue;
              const nbx = nb % w, nby = (nb - nbx) / w;
              if (nbx < 1 || nbx >= w - 1 || nby < 1 || nby >= h - 1) continue;
              if (seen[nb]) continue;
              if (isHot(d, nb * 4)) { seen[nb] = 1; stack.push(nb); }
            }
          }
          if (n < 5) continue;
          const cw = maxX - minX + 1, ch = maxY - minY + 1;
          out.push({
            x: sumX / n, y: sumY / n,
            minX, maxX, minY, maxY, w: cw, h: ch, area: n
          });
        }
      }
      return out;
    },

    compactScore(c) {
      const rad = Math.max(c.w, c.h) / 2;
      if (rad <= 0) return 0;
      return (c.area / (Math.PI * rad * rad));
    },

    /* --- detectar balón (blanco sólido, redondo, dentro del campo) --- */
    detectBall(px) {
      const mask = (d, p) => d[p] >= 225 && d[p + 1] >= 225 && d[p + 2] >= 225 && d[p + 3] > 120;
      const comps = this.components(px, mask);
      const f = this.field;
      const sq = (px.w * px.h) / (CFG.worldW * CFG.worldH);
      let best = null, bestScore = 0;
      for (const c of comps) {
        const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
        if (!f) continue;
        if (cx < f.x0 + 3 || cx > f.x1 - 3 || cy < f.y0 + 3 || cy > f.y1 - 3) continue;
        /* área esperada: pi * (radio 10u * sq)²  ... con margen amplio */
        const expArea = Math.PI * Math.pow(10 * sq, 2);
        if (c.area < expArea * 0.3 || c.area > 1400) continue;
        /* forma redonda */
        const ar = Math.max(c.w, c.h) / Math.max(1, Math.min(c.w, c.h));
        if (ar > 1.9) continue;
        const score = this.compactScore(c);
        if (score > bestScore) { bestScore = score; best = { x: cx, y: cy }; }
      }
      this.ball = best;
      return best;
    },

    /* --- detectar jugadores por color de equipo --- */
    detectPlayers(px) {
      const teams = [
        { name: 'red',  mask: (d, p) => d[p] >= 150 && d[p + 1] <= 100 && d[p + 2] <= 100 && d[p] - d[p + 2] >= 70 },
        { name: 'blue', mask: (d, p) => d[p + 2] >= 150 && d[p] <= 100 && d[p + 1] <= 100 && d[p + 2] - d[p] >= 70 }
      ];
      const f = this.field;
      const sq = (px.w * px.h) / (CFG.worldW * CFG.worldH);
      const out = [];
      for (const t of teams) {
        const comps = this.components(px, t.mask);
        /* Los avatares dibujan su imagen sobre el disco; el borde de equipo
           es fino → área media entre 8 y ~400 px² en el downsample */
        const expArea = Math.PI * Math.pow(15 * sq, 2);
        for (const c of comps) {
          const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
          if (!f) continue;
          if (cx < f.x0 + 2 || cx > f.x1 - 2 || cy < f.y0 + 2 || cy > f.y1 - 2) continue;
          if (c.area < 8 || c.area > expArea * 1.6) continue;
          out.push({ x: cx, y: cy, color: t.name, area: c.area });
        }
      }
      this.players = out;
      return out;
    },

    /* --- convertir coord del downsample → mundo --- */
    toWorld(c, f, pw, ph) {
      const fx = c.x / pw, fy = c.y / ph;
      return {
        x: (f.x0 + fx * (f.x1 - f.x0)) / (f.x1 - f.x0) * CFG.worldW,
        y: (f.y0 + fy * (f.y1 - f.y0)) / (f.y1 - f.y0) * CFG.worldH
      };
    },

    /* --- "yo": clic del usuario o auto (más cercano al balón) --- */
    updateMe() {
      const ball = this.ball;
      if (!CFG.autoMe || !ball || !this.players.length) return;
      let best = null, bestD = 1e9;
      for (const p of this.players) {
        const d = Math.hypot(p.x - ball.x, p.y - ball.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return;
      if (!this.me) this.me = { x: best.x, y: best.y, color: best.color };
      else {
        const d = Math.hypot(best.x - this.me.x, best.y - this.me.y);
        if (d < 40) { this.me.x = best.x; this.me.y = best.y; this.me.color = best.color; }
      }
    },

    /* --- procesar frame --- */
    process() {
      this.pix = Loc.win ? Loc.win.__opmode_pix : null;
      if (!this.pix || !this.pix.data) return false;

      const f = this.detectField(this.pix);
      this.field = f;
      if (!f) return false;

      this.detectBall(this.pix);
      if (!this.ball) return false;

      this.detectPlayers(this.pix);
      if (!this.me || !this.me.pinned) this.updateMe();

      const pw = this.pix.w, ph = this.pix.h;
      this.ballWorld = this.toWorld(this.ball, f, pw, ph);
      if (this.me && !this.me.pinned && this.me.x != null) {
        this.me.world = this.toWorld(this.me, f, pw, ph);
      }
      return true;
    },

    /* --- modo demo: simula el campo y el balón --- */
    processDemo() {
      const t = performance.now() / 1000;
      if (!this.demo) this.demo = { x: 400, y: 200, vx: 40, vy: 30 };
      const d = this.demo;
      d.x += d.vx * 0.016; d.y += d.vy * 0.016;
      if (d.x < 80 || d.x > 720) d.vx *= -1;
      if (d.y < 80 || d.y > 320) d.vy *= -1;
      this.ball = { x: d.x, y: d.y };
      this.ballWorld = { x: d.x, y: d.y };
      this.me = {
        x: 300 + Math.sin(t * 4) * 120, y: 200 + Math.cos(t * 3) * 70,
        color: 'red', world: { x: 300 + Math.sin(t * 4) * 120, y: 200 + Math.cos(t * 3) * 70 }
      };
      return true;
    }
  };

  /* ================ 6. FUENTE DE DATOS POR API (opcional) ================ */
  const Data = {
    kind: 'none',        /* 'pixels' | 'room' | 'g' | 'custom' | 'demo' */
    src: null,
    custom: null,
    meApi: null,
    ballApi: null,
    vx: 0, vy: 0,
    lastBall: null, lastDt: 0,

    detectApi() {
      if (this.custom) { this.kind = 'custom'; return; }
      const w = Loc.win;
      if (!w) return;
      try {
        const g = w.g;
        if (g && typeof g.getPlayerList === 'function' &&
            (typeof g.getBallPosition === 'function' || g.room)) {
          this.src = g; this.kind = 'g'; return;
        }
        for (const n of ['Room', 'room', 'hbRoom']) {
          const v = w[n];
          if (v && typeof v.getPlayerList === 'function' && typeof v.getBallPosition === 'function') {
            this.src = v; this.kind = 'room'; return;
          }
        }
      } catch (e) { /* sin acceso */ }
      this.kind = 'pixels';   /* por defecto: lectura de píxeles */
    },

    poll(dt) {
      this.detectApi();
      if (this.custom) {
        try {
          const d = this.custom();
          if (d && typeof d === 'object') {
            const np = (p) => p ? (p.position || (isFinite(p.x) && isFinite(p.y) ? p : null)) : null;
            const bp = np(d.ball);
            if (bp) { this.ballApi = { x: bp.x, y: bp.y }; }
            const mp = np(d.me);
            if (mp) this.meApi = { world: { x: mp.x, y: mp.y }, team: d.team, name: d.name, color: d.team === 1 ? 'red' : 'blue' };
            this.trackBallVel(dt);
          }
        } catch (e) { /* fuente custom con error */ }
        return;
      }
      if (this.kind !== 'room' && this.kind !== 'g') return;

      let me = null, ball = null;
      try {
        if (this.kind === 'room') {
          ball = this.src.getBallPosition();
          const pl = this.src.getPlayerList();
          let myId = this.src.currentPlayerId;
          if (myId == null) myId = this.src.playerId;
          me = (pl || []).find(p => p && p.id === myId);
        } else if (this.kind === 'g') {
          ball = this.src.getBallPosition ? this.src.getBallPosition() : null;
          if (ball == null && this.src.room && this.src.room.roomState && this.src.room.roomState.game) {
            ball = this.src.room.roomState.game.ball;
          }
          me = this.src.playerId != null ? this.src.getPlayer(this.src.playerId) : null;
          if (me && this.src.getPlayer) me = this.src.getPlayer(this.src.playerId);
        }
      } catch (e) { /* transición */ }

      const np = (p) => {
        if (!p) return null;
        if (p.position) return { x: p.position.x, y: p.position.y };
        if (isFinite(p.x) && isFinite(p.y)) return { x: p.x, y: p.y };
        return null;
      };
      this.ballApi = np(ball);
      this.meApi = np(me) ? { world: np(me), team: me.team, name: me.name, color: me.team === 1 ? 'red' : 'blue' } : null;
      this.trackBallVel(dt);
    },

    trackBallVel(dt) {
      this.trackVel(this.ballApi, dt);
    },

    /* Estimación de velocidad por puntos del mundo (API o píxeles) */
    trackVel(pt, dt) {
      if (pt) {
        if (this.lastBall) {
          const dx = pt.x - this.lastBall.x;
          const dy = pt.y - this.lastBall.y;
          if (dt > 0 && dt < 0.25) {
            const a = 0.35;
            this.vx += a * (dx / dt - this.vx);
            this.vy += a * (dy / dt - this.vy);
          }
        }
        this.lastBall = { x: pt.x, y: pt.y };
      }
    }
  };

  /* ================ 7. DIBUJO ================ */
  const Draw = {
    /* mundo → pantalla (overlay fixed), usando el rect del canvas */
    mapping() {
      const R = Loc.canvasRect();
      if (!R) return null;
      return {
        ox: R.left, oy: R.top,
        sx: R.width / CFG.worldW,
        sy: R.height / CFG.worldH
      };
    },

    toScreen(px, M) {
      return { x: M.ox + px.x * M.sx, y: M.oy + px.y * M.sy };
    },

    line(a, b, color, width, dash, glow) {
      const ctx = Overlay.ctx;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    },

    circle(c, rPx, color, width, fill, glow) {
      const ctx = Overlay.ctx;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.shadowBlur = 0;
    },

    dot(c, rPx, color, fill) {
      const ctx = Overlay.ctx;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = fill || color;
      ctx.fill();
    },

    render(dt, source) {
      const V = Vis;
      if (!V.overlay) return;
      if (!Overlay.ctx) return;
      Overlay.sync();
      const ctx = Overlay.ctx;
      const M = this.mapping();
      if (!M) return;

      const color = CFG.style.color;
      const w = CFG.style.width;

      /* --- balón --- */
      const ball = source.ballWorld;
      const me = source.me && source.me.world ? source.me.world : null;

      /* Línea balón → arco rival (el arco MÁS LEJANO del balón) */
      if (V.lineBallGoal && ball) {
        const gx = ball.x > CFG.worldW / 2 ? 0 : CFG.worldW;
        const goal = { x: gx, y: CFG.worldH / 2 };
        this.line(this.toScreen(ball, M), this.toScreen(goal, M), color, w, [], true);
        this.circle(this.toScreen(goal, M), 12, color, 2.5, null, true);
      }

      /* Línea yo → balón */
      if (V.lineMeBall && me && ball) {
        this.line(this.toScreen(me, M), this.toScreen(ball, M), '#ffd94d', Math.max(2, w * 0.7), [8, 7], true);
      }

      /* Radio de alcance / contacto */
      if (V.radius) {
        if (ball) {
          const rBall = (CFG.ballRadius * CFG.reachMult) * M.sx;
          this.circle(this.toScreen(ball, M), rBall, color, 2, 'rgba(0,255,213,0.05)', true);
        }
        if (me) {
          const rMe = (CFG.playerRadius * 1.3) * M.sx;
          const hasBall = ball && Math.hypot(ball.x - me.x, ball.y - me.y) <= (CFG.playerRadius + CFG.ballRadius) * 1.3;
          this.circle(this.toScreen(me, M), rMe,
            hasBall ? '#39ff7a' : color, 2, hasBall ? 'rgba(57,255,122,0.08)' : 'rgba(255,217,77,0.06)', true);
        }
      }

      /* Trayectoria estimada del balón */
      if (V.trajectory && ball) {
        let vx = source.vx !== undefined ? source.vx : Data.vx;
        let vy = source.vy !== undefined ? source.vy : Data.vy;
        if (!isFinite(vx) || !isFinite(vy)) vx = vy = 0;
        const sp = Math.hypot(vx, vy);
        if (sp > 4) {
          const ahead = Math.min(90, sp * 0.55);
          this.line(
            this.toScreen(ball, M),
            this.toScreen({ x: ball.x + (vx / sp) * ahead, y: ball.y + (vy / sp) * ahead }, M),
            'rgba(255,255,255,0.85)', 1.8, [4, 5], true
          );
        }
      }

      /* Marcador de "yo" */
      if (me) {
        const c = this.toScreen(me, M);
        this.circle(c, 10, '#ffffff', 2, null, true);
        this.dot(c, 3, '#ffffff', '#ffffff');
      }
    }
  };

  /* ================ 8. VISIBILIDAD ================ */
  const Vis = {
    set(k, v) { CFG.vis[k] = v; persist(); }
  };

  /* ================ 9. PERSISTENCIA ================ */
  const SSKEY = 'opmode_cfg';
  function persist() {
    try {
      localStorage.setItem(SSKEY, JSON.stringify({ vis: CFG.vis, style: CFG.style, autoMe: CFG.autoMe }));
    } catch (e) { /* sin storage */ }
  }

  /* ================ 10. MENÚ DESPLEGABLE (mod menu) ================ */
  const Menu = {
    el: null,
    open: false,

    build() {
      if (this.el) return;
      const root = document.createElement('div');
      root.setAttribute('data-opmode-menu', '1');
      root.style.cssText = [
        'position:fixed;top:10px;right:10px;z-index:2147482601;',
        'font:12px/1.45 "Segoe UI",system-ui,sans-serif;color:#dff6f1;',
        'user-select:none;pointer-events:auto;'
      ].join('');
      root.innerHTML = `
        <button data-op="toggle" style="cursor:pointer;background:#0a121add;border:1px solid #00ffd555;color:#00ffd5;border-radius:8px;padding:6px 10px;font-weight:700;letter-spacing:1px;box-shadow:0 0 12px #00ffd533">🎯 OP&nbsp;·&nbsp;M</button>
        <div data-op="panel" style="display:none;margin-top:6px;width:248px;background:#0a121ae9;border:1px solid #00ffd544;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px #0009">
          <div id="opmode-status" style="margin-bottom:8px;font-size:11px;line-height:1.5;color:#9be8d8"></div>
          <label style="display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer"><input data-op="cb" type="checkbox" data-k="lineBallGoal"> Línea balón → arco</label>
          <label style="display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer"><input data-op="cb" type="checkbox" data-k="lineMeBall"> Línea yo → balón</label>
          <label style="display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer"><input data-op="cb" type="checkbox" data-k="radius"> Radio de alcance</label>
          <label style="display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer"><input data-op="cb" type="checkbox" data-k="trajectory"> Trayectoria</label>
          <label style="display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer"><input data-op="cb" type="checkbox" data-k="demo"> Demo (sin campo)</label>
          <label style="display:flex;gap:8px;align-items:center;margin:4px 0;cursor:pointer"><input data-op="cb" type="checkbox" data-k="autoMe"> "Yo" automático</label>
          <label style="display:block;margin:8px 0 2px;color:#9be8d8">Grosor líneas
            <input data-op="range" type="range" min="1" max="10" value="${CFG.style.width}" style="width:100%"></label>
          <div style="display:flex;gap:6px;margin:8px 0">
            ${['#00ffd5','#ffd94d','#ff5252','#4d79ff','#b24dff','#ffffff'].map(c =>
              `<span data-op="color" data-c="${c}" style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c===CFG.style.color?'#fff':'#0000'}"></span>`).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button data-op="pick" style="flex:1;cursor:pointer;background:#ffd94d22;border:1px solid #ffd94d88;color:#ffd94d;border-radius:6px;padding:5px">🎯 Soy yo</button>
            <button data-op="kill" style="flex:1;cursor:pointer;background:#ff525222;border:1px solid #ff525288;color:#ff5252;border-radius:6px;padding:5px">✖ Apagar</button>
          </div>
        </div>`;
      document.body.appendChild(root);
      this.el = root;

      root.querySelector('[data-op="toggle"]').onclick = () => this.setOpen(!this.open);
      root.querySelectorAll('[data-op="cb"]').forEach(cb => {
        cb.checked = cb.dataset.k === 'autoMe' ? !!CFG.autoMe : !!CFG.vis[cb.dataset.k];
        cb.onchange = () => {
          if (cb.dataset.k === 'autoMe') { CFG.autoMe = !!cb.checked; persist(); }
          else { CFG.vis[cb.dataset.k] = !!cb.checked; persist(); }
        };
      });
      root.querySelector('[data-op="range"]').oninput = (e) => {
        CFG.style.width = +e.target.value;
        persist();
      };
      root.querySelectorAll('[data-op="color"]').forEach(s => {
        s.onclick = () => {
          CFG.style.color = s.dataset.c;
          root.querySelectorAll('[data-op="color"]').forEach(x => x.style.borderColor = x === s ? '#fff' : '#0000');
          persist();
        };
      });
      root.querySelector('[data-op="pick"]').onclick = () => Vision.startPick();
      root.querySelector('[data-op="kill"]').onclick = () => OpMode.destroy();
    },

    setOpen(v) {
      this.open = v;
      const p = this.el.querySelector('[data-op="panel"]');
      const b = this.el.querySelector('[data-op="toggle"]');
      p.style.display = v ? 'block' : 'none';
      b.textContent = v ? '▾ OP · M' : '🎯 OP · M';
    },

    updateStatus(text) {
      const s = this.el && this.el.querySelector('#opmode-status');
      if (s) s.textContent = text;
    }
  };

  /* Modo "elige tu jugador": un clic sobre la ventana fija tu posición */
  const Picker = {
    on: false,
    handler(e) {
      if (!Picker.on) return;
      Picker.on = false;
      Menu.setOpen(false);
      const M = Draw.mapping();
      if (!M) return;
      const x = ((e.clientX - M.ox) / M.sx);
      const y = ((e.clientY - M.oy) / M.sy);
      Vision.me = { world: { x, y }, color: Vision.me ? Vision.me.color : 'red', pinned: true };
      CFG.autoMe = false;
      persist();
      util.log('Yo fijado en (' + x.toFixed(0) + ', ' + y.toFixed(0) + ')');
    }
  };

  Vision.startPick = function () {
    Picker.on = true;
    Menu.setOpen(false);
    util.log('Clica sobre tu jugador para fijarlo como "yo".');
  };

  /* ================ 11. ATAJOS + BUCLE PRINCIPAL ================ */
  let lastTs = 0;
  let frame = 0;
  let keysBoundFrame = null;

  function bindKeys() {
    const w = Loc.win;
    if (!w || keysBoundFrame === w) return;
    keysBoundFrame = w;
    /* El juego captura el foco dentro del iframe: escuchar también allí */
    if (w.document && w.document !== document) {
      w.document.addEventListener('keydown', onKey, false);
      _boundWins.push(w);
    }
  }
  const _boundWins = [];

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const K = CFG.keys;
    const set = (k, label) => {
      CFG.vis[k] = !CFG.vis[k];
      persist();
      util.log(label + (CFG.vis[k] ? ' ON' : ' OFF'));
    };
    switch (e.code) {
      case K.menu: Menu.setOpen(!Menu.open); break;
      case K.lineBallGoal: set('lineBallGoal', 'Línea balón→arco'); break;
      case K.lineMeBall: set('lineMeBall', 'Línea yo→balón'); break;
      case K.radius: set('radius', 'Radio de alcance'); break;
      case K.trajectory: set('trajectory', 'Trayectoria'); break;
      case K.overlay: CFG.vis.overlay = !CFG.vis.overlay; persist(); util.log('Overlay ' + (CFG.vis.overlay ? 'visible' : 'oculto')); break;
    }
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    frame++;

    try {
      Loc.update();
      bindKeys();
      Sampler.init();

      if (!Overlay.canvas) Overlay.create();
      Menu.build();

      /* Fuente de datos por API (si el cliente la expone) o píxeles */
      Data.poll(dt);

      let source = null;
      let apiSource = null;
      if ((Data.kind === 'room' || Data.kind === 'g' || Data.kind === 'custom') && Data.ballApi) {
        apiSource = { ballWorld: Data.ballApi, me: Data.meApi || undefined, vx: Data.vx, vy: Data.vy };
      }

      /* análisis por píxeles: sirve como respaldo y como fuente principal */
      Vision.process();
      if (Vision.ballWorld) Data.trackVel(Vision.ballWorld, dt);

      if (apiSource) source = apiSource;
      else if (Vision.ballWorld) source = { ballWorld: Vision.ballWorld, me: Vision.me || undefined, vx: Data.vx, vy: Data.vy };
      else if (CFG.vis.demo && Vision.processDemo()) source = { ballWorld: Vision.ballWorld, me: Vision.me, vx: 0, vy: 0, demo: true };

      /* estado para el menú */
      const hasField = !!Vision.field;
      const srcLabel = Data.kind === 'pixels'
        ? (Vision.ballWorld ? 'PÍXELES' : hasField ? 'PÍXELES (campo ok)' : 'PÍXELES (buscando campo)')
        : Data.kind.toUpperCase();
      Menu.updateStatus('Datos: ' + srcLabel +
        (Vision.ballWorld ? ' · balón ✓' : ' · sin balón') +
        (Vision.me ? ' · yo ✓' : ''));

      Draw.render(dt, source);
    } catch (e) { /* el bucle nunca se rompe */ }
  }

  /* ================ 12. API PÚBLICA ================ */
  const OpMode = {
    _opmode: true,

    get version() { return CFG.version; },

    get state() {
      return {
        source: Data.kind,
        ball: Vision.ballWorld || null,
        me: (Vision.me && Vision.me.world) || Data.meApi || null,
        field: !!Vision.field,
        vis: Object.assign({}, CFG.vis)
      };
    },

    toggle(what) {
      if (what in CFG.vis) {
        CFG.vis[what] = !CFG.vis[what];
        persist();
        util.log(what + ' → ' + (CFG.vis[what] ? 'ON' : 'OFF'));
      } else util.log('Opciones: lineBallGoal, lineMeBall, radius, trajectory, demo, overlay');
    },

    /* Fuente de datos externa:
         OpMode.setDataSource(() => ({ me:{x,y,team}, ball:{x,y} }))
       null para volver a píxeles. */
    setDataSource(fn) {
      Data.custom = typeof fn === 'function' ? fn : null;
      if (Data.custom) Data.kind = 'custom';
      else { Data.kind = 'pixels'; Data.src = null; }
      util.log(Data.custom ? 'Fuente custom activada.' : 'Vuelta a detección por píxeles.');
    },

    /* Fijar manualmente "yo" desde consola: OpMode.setMe(x, y) */
    setMe(x, y) {
      if (typeof x === 'object' && x != null) { y = x.y; x = x.x; }
      if (!isFinite(x) || !isFinite(y)) return util.log('Uso: OpMode.setMe(x, y) o OpMode.setMe({x, y})');
      Vision.me = { world: { x, y }, color: Vision.me ? Vision.me.color : 'red', pinned: true };
      CFG.autoMe = false;
      persist();
      util.log('Yo fijado en (' + x.toFixed(0) + ', ' + y.toFixed(0) + ').');
    },

    pickMe() { Vision.startPick(); },

    resetMe() {
      Vision.me = null;
      CFG.autoMe = true;
      persist();
      util.log('"Yo" reiniciado (auto).');
    },

    destroy() {
      cancelAnimationFrame(loop);
      document.removeEventListener('keydown', onKey, false);
      document.removeEventListener('click', Picker.handler, true);
      for (const w of _boundWins) {
        if (w.document) w.document.removeEventListener('keydown', onKey, false);
      }
      _boundWins.length = 0;
      keysBoundFrame = null;
      if (Overlay.canvas) Overlay.remove();
      if (Menu.el && Menu.el.parentNode) Menu.el.parentNode.removeChild(Menu.el);
      Menu.el = null;
      if (Loc.win) delete Loc.win.__opmode_pix;
      Sampler.enabled = false;
      if (Sampler.off && Sampler.off.parentNode) Sampler.off.parentNode.removeChild(Sampler.off);
      Sampler.off = null; Sampler.offCtx = null;
      if (window.OpMode === OpMode) delete window.OpMode;
      util.log('Apagado. F5 para un reinicio limpio.');
    },

    help() {
      const txt = [
        'M menú · N línea balón→arco · J línea yo→balón · B radio · V trayectoria · K overlay',
        'OpMode.toggle(m), OpMode.setMe(x,y), OpMode.pickMe(), OpMode.setDataSource(fn), OpMode.destroy()'
      ];
      console.log('%c' + txt.join('\n'), 'color:#9be8d8');
    }
  };

  /* ================ ARRANQUE ================ */
  try {
    const saved = JSON.parse(localStorage.getItem(SSKEY) || '{}');
    CFG = Object.assign({}, JSON.parse(JSON.stringify(DEFAULTS)),
      { vis: Object.assign({}, DEFAULTS.vis, saved.vis || {}),
        style: Object.assign({}, DEFAULTS.style, saved.style || {}),
        autoMe: saved.autoMe !== undefined ? !!saved.autoMe : DEFAULTS.autoMe });
  } catch (e) {
    CFG = JSON.parse(JSON.stringify(DEFAULTS));
  }

  document.addEventListener('keydown', onKey, false);
  document.addEventListener('click', Picker.handler, true);

  window.OpMode = OpMode;
  Overlay.create();
  Menu.build();

  requestAnimationFrame(loop);
  util.log('v' + CFG.version + ' activado. Pulsa M para el menú, K para ocultar el overlay.');
  util.log('Sin texto en pantalla o en el lobby: actíva el modo Demo desde el menú (M).');
})();