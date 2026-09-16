/* ======================================================================
   OpMode · Haxball Client Assistant   ·   v3.0.0
   ----------------------------------------------------------------------
   Script 100% cliente para pegar en la consola DevTools (F12) de
   https://www.haxball.com/play   (Funciona pegando en la consola del
   iframe del juego O en la consola de nivel superior: se auto-detecta.)

   POR QUÉ v3 EN VEZ DE v2
   -----------------------
   - El juego NO expone ninguna API de posiciones (se verificó contra el
     game-min.js actual): ni Room, ni window.g, ni getBallPosition.
   - El juego renderiza con un canvas 2D  (getContext("2d",{alpha:false,
     desynchronized:true})). v2 asumía WebGL (hook de rAF + readPixels):
     por eso no dibujaba nada y además leía a resolución completa cada
     frame (caída de FPS).
   - v3 usa el método correcto y barato: cada ~2 frames se baja el canvas
     del juego a ~320px de ancho con drawImage (acelerado por GPU) y se
     lee getImageData de ese mini-buffer. Coste despreciable, funciona a
     60fps sin hundir el rendimiento. Detecta campo (verde), balón
     (blanco) y jugadores (rojo/azul) por componentes conexas.

   EXTRAS
   - Panel desplegable (M): toggles de ayudas, grosor, color, estado de
     detección, "Soy yo" (clic sobre tu jugador) y modo Demo.
   - Sin campo visible → demo animada para ver las líneas al instante.
   - Fuente de datos por API opcional: OpMode.setDataSource(fn).

   ATAJOS:  M menú · N línea balón→arco · J línea yo→balón · B radio ·
            V trayectoria · K overlay.
   ====================================================================== */
(() => {
  'use strict';

  if (window.OpMode && window.OpMode._opmode) {
    console.warn('[OpMode] Ya hay una instancia activa. Escribe OpMode.destroy() y vuelve a pegar.');
    return;
  }

  /* ================ 1. CONFIGURACIÓN ================ */
  const DEFAULTS = {
    version: '3.0.0',
    worldW: 800,
    worldH: 400,
    ballRadius: 10,
    playerRadius: 15,
    reachMult: 1.6,          /* radio de alcance dibujado (unidades de mundo) */
    sampleWTarget: 320,      /* ancho del downsample de análisis             */
    tickEvery: 2,            /* analizar cada N frames (~30fps con 2)        */
    autoMe: true,            /* "yo" = el jugador más cercano al balón       */
    vis: {
      lineBallGoal: true,
      lineMeBall: true,
      radius: true,
      trajectory: true,
      demo: true,
      overlay: true
    },
    style: { color: '#00ffd5', width: 4 },
    keys: { menu: 'KeyM', lbg: 'KeyN', lmb: 'KeyJ', radius: 'KeyB', traj: 'KeyV', overlay: 'KeyK' }
  };

  let CFG = {};
  const SSKEY = 'opmode_cfg';
  function persist() {
    try {
      localStorage.setItem(SSKEY, JSON.stringify({ vis: CFG.vis, style: CFG.style, autoMe: CFG.autoMe }));
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
    } catch (e) { CFG = JSON.parse(JSON.stringify(DEFAULTS)); }
  }

  const util = {
    log(msg) { console.log('%c[OPMODE] ' + msg, 'color:#00ffd5;font-weight:bold;background:#0a121a;padding:2px 6px;border-radius:3px'); },
    clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
    dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  };

  /* ================ 2. DOCUMENTO ANFITRIÓN (robusto a dónde pegas) ================ */
  const Host = {
    topWin: null,        /* window.top (mismo origen) o window    */
    doc: null,           /* documento donde se montan overlay+menu */
    iframes: [],         /* iframes del documento anfitrión       */
    canvas: null,        /* canvas del juego elegido              */
    candidates: [],      /* otros canvás grandes por si el 1º es el equivocado */
    rect: null,
    lastScan: 0,

    init() {
      this.topWin = (window.top && window.top.location.origin === window.location.origin) ? window.top : window;
      this.doc = this.topWin.document;
      this.scan();
    },

    /* Listar iframes y canvás del documento anfitrión */
    gather() {
      const out = { iframes: [], canvases: [] };
      try {
        out.iframes = Array.from(this.doc.querySelectorAll('iframe'));
        for (const d of [this.doc, ...out.iframes.map(f => {
          try { return f.contentDocument; } catch (e) { return null; }
        })]) {
          if (!d) continue;
          for (const c of d.querySelectorAll && d.querySelectorAll('canvas') || []) {
            const r = c.getBoundingClientRect();
            if (!r || r.width < 120 || r.height < 80) continue;
            out.canvases.push({ c, doc: d, area: r.width * r.height });
          }
        }
      } catch (e) {}
      out.canvases.sort((a, b) => b.area - a.area);
      return out;
    },

    /* Seleccionar el canvas del juego: probar candidatos hasta que uno dé
       campo + algo en movimiento (el fondo verde estático se descarta) */
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
      Vision.emptyFail = 0;
      this.rect = null;
    },

    /* Escaneo periódico: re-elige canvas cuando se pierde o el DOM cambia */
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

  /* ================ 3. OVERLAY (canvas fullscreen, invisible al ratón) ================ */
  const Overlay = {
    canvas: null,
    ctx: null,
    w: 0, h: 0,

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
      const dpr = this.canvas.ownerDocument.defaultView.devicePixelRatio || 1;
      const pw = Math.round(v.w * dpr), ph = Math.round(v.h * dpr);
      if (this.canvas.width !== pw) this.canvas.width = pw;
      if (this.canvas.height !== ph) this.canvas.height = ph;
      this.w = v.w; this.h = v.h;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, v.w, v.h);
    }
  };

  /* ================ 4. MUESTREO DEL CANVAS (barato, 2D) ================ */
  const Sampler = {
    sw: 0, sh: 0,          /* dims del downsample */
    off: null, offCtx: null,
    gl: null, glBuf: null, glW: 0, glH: 0,
    mode: null,            /* '2d' | 'webgl' | null */
    ok: false,
    tried: {},

    reset() { this.ok = false; this.mode = null; this.tried = {}; },

    /* Miniatura RGBA del canvas del juego (sin asignar memoria por frame) */
    frame() {
      const c = Host.canvas;
      if (!c || !c.isConnected) return null;
      const cw = c.width, ch = c.height;
      if (!cw || !ch) return null;

      const target = Math.min(CFG.sampleWTarget, cw);
      const step = Math.max(1, Math.round(cw / target));
      const sw = Math.floor(cw / step);
      const sh = Math.max(1, Math.floor(ch / step));

      /* ---- intento 2D (el juego es 2D) ---- */
      if (this.mode !== 'webgl') {
        let ctx = this.get2D(c);
        if (!ctx) { this.mode = 'webgl'; }
        else {
          try {
            if (!this.off) {
              this.off = Host.doc.createElement('canvas');
              this.offCtx = this.off.getContext('2d');
            }
            if (this.off.width !== sw) this.off.width = sw;      /* solo se reasigna si cambió */
            if (this.off.height !== sh) this.off.height = sh;
            this.offCtx.drawImage(c, 0, 0, sw, sh);
            const img = this.offCtx.getImageData(0, 0, sw, sh);
            this.sw = sw; this.sh = sh;
            return img.data;
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
          this.offCtx = this.off.getContext('2d');
        }
        if (this.off.width !== sw) this.off.width = sw;
        if (this.off.height !== sh) this.off.height = sh;
        const img = this.offCtx.createImageData(sw, sh);
        const src = this.glBuf;
        const dst = img.data;
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
        return img.data;
      } catch (e) { return null; }
    },

    get2D(c) {
      try {
        if (c.__opmode_2d === undefined) {
          /* getContext('2d') nos devuelve el contexto real del juego */
          const ctx = c.getContext('2d', { willReadFrequently: true });
          c.__opmode_2d = !!ctx;
        }
        return c.__opmode_2d ? c.getContext('2d') : null;
      } catch (e) { return null; }
    },

    /* ¿El frame está en blanco (canvas equivocado / sin render)? */
    isBlank(data) {
      let sum = 0, n = 0;
      for (let i = 0; i < data.length; i += 64) { sum += data[i] + data[i + 1] + data[i + 2]; n += 3; }
      return n === 0 || (sum / n) < 3;   /* casi todo negro/transparente */
    }
  };

  /* ================ 5. VISIÓN (análisis de la miniatura) ================ */
  const Vision = {
    data: null,
    field: null,          /* {x0,y0,x1,y1} en coords del downsample */
    ball: null,           /* {x,y} sample */
    ballWorld: null,
    players: [],          /* [{x,y,color}] sample */
    me: null,             /* {x,y,color} sample + world */
    vx: 0, vy: 0, lastBall: null,
    blankFrames: 0,
    emptyFail: 0,

    resetField() { this.field = null; this.blankFrames = 0; this.emptyFail = 0; },

    /* componente conexas sobre una máscara */
    components(mask, sw, sh) {
      const seen = new Uint8Array(sw * sh);
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

    /* rectángulo del campo a partir del verde */
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
      const a = 0.15;   /* EMA: la posición del campo no salta */
      this.field.x0 += a * (f.x0 - this.field.x0);
      this.field.y0 += a * (f.y0 - this.field.y0);
      this.field.x1 += a * (f.x1 - this.field.x1);
      this.field.y1 += a * (f.y1 - this.field.y1);
      return this.field;
    },

    detectBall(data, sw, sh, f) {
      const mask = (i) => {
        const p = i * 4;
        return data[p] >= 225 && data[p + 1] >= 225 && data[p + 2] >= 225;
      };
      const comps = this.components(mask, sw, sh);
      const sq = (sw * sh) / (CFG.worldW * CFG.worldH);
      let best = null, score = 0;
      for (const c of comps) {
        const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
        if (cx < f.x0 + 3 || cx > f.x1 - 3 || cy < f.y0 + 3 || cy > f.y1 - 3) continue;
        const ar = Math.max(c.w, c.h) / Math.max(1, Math.min(c.w, c.h));
        if (ar > 1.7) continue;
        const exp = Math.PI * Math.pow(10 * sq, 2);
        if (c.area < exp * 0.3 || c.area > 1500) continue;
        const rad = Math.max(c.w, c.h) / 2;
        const round = rad > 0 ? c.area / (Math.PI * rad * rad) : 0;
        /* continuidad: premiar el candidato próximo al balón anterior */
        const dPrev = this.ball ? (1 / (1 + util.dist({ x: cx, y: cy }, this.ball))) : 0;
        const s = round + dPrev * 0.4;
        if (s > score) { score = s; best = { x: cx, y: cy }; }
      }
      this.ball = best;
      return best;
    },

    detectPlayers(data, sw, sh, f) {
      const teams = [
        { color: 'red',  mask: (i) => { const p = i * 4; return data[p] >= 150 && data[p + 1] <= 100 && data[p + 2] <= 100 && data[p] - data[p + 2] >= 70; } },
        { color: 'blue', mask: (i) => { const p = i * 4; return data[p + 2] >= 150 && data[p] <= 100 && data[p + 1] <= 100 && data[p + 2] - data[p] >= 70; } }
      ];
      const sq = (sw * sh) / (CFG.worldW * CFG.worldH);
      const exp = Math.PI * Math.pow(15 * sq, 2);
      let out = [];
      for (const t of teams) {
        for (const c of this.components(t.mask, sw, sh)) {
          const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2;
          if (cx < f.x0 + 2 || cx > f.x1 - 2 || cy < f.y0 + 2 || cy > f.y1 - 2) continue;
          if (c.area < 7 || c.area > exp * 1.8) continue;
          out.push({ x: cx, y: cy, color: t.color });
        }
      }
      this.players = out;
      return out;
    },

    toWorld(p, sw, sh) {
      const f = this.field;
      const fx = p.x / sw, fy = p.y / sh;
      return {
        x: ((f.x0 + fx * (f.x1 - f.x0)) / (f.x1 - f.x0)) * CFG.worldW,
        y: ((f.y0 + fy * (f.y1 - f.y0)) / (f.y1 - f.y0)) * CFG.worldH
      };
    },

    /* "yo": fijado manualmente o el jugador más cercano al balón */
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
        /* campo verde pero nada vivo: probablemente el fondo estático */
        this.emptyFail++;
        if (this.emptyFail > 9) Host.advance();
        return false;
      }
      this.emptyFail = 0;
      if (!this.ball) { this.ballWorld = null; return false; }

      this.updateMe();

      this.ballWorld = this.toWorld(this.ball, sw, sh);
      if (this.me && !this.me.pinned) this.me.world = this.toWorld(this.me, sw, sh);
      return true;
    },

    /* Velocidad EMA en unidades de mundo */
    trackVel(w, dt) {
      if (!w) { this.lastBall = null; return; }
      if (this.lastBall) {
        const dx = w.x - this.lastBall.x, dy = w.y - this.lastBall.y;
        if (dt > 0 && dt < 0.25) { const a = 0.35; this.vx += a * (dx / dt - this.vx); this.vy += a * (dy / dt - this.vy); }
      }
      this.lastBall = { x: w.x, y: w.y };
    },

    /* Demo: simulación animada cuando no hay campo ni partida */
    demo(demoTick) {
      const t = demoTick * 0.016;
      const cx = 400 + Math.sin(t * 1.1) * 260;
      const cy = 200 + Math.sin(t * 1.9) * 130;
      this.ballWorld = { x: cx, y: cy };
      this.ball = { x: cx, y: cy };
      this.me = {
        world: { x: 200 + Math.sin(t * 2.3) * 120, y: 120 + Math.cos(t * 2.7) * 60 },
        x: 0, y: 0, color: 'red', pinned: false
      };
      return true;
    }
  };

  /* ================ 6. MAPPING mundo → pantalla ================ */
  function buildMapping() {
    const R = Host.canvasRect();
    const v = Host.viewport();
    const cw = R ? R.width : v.w, ch = R ? R.height : v.h;
    let ox = R ? R.left : 0, oy = R ? R.top : 0;
    let sx = cw / CFG.worldW, sy = ch / CFG.worldH;

    /* Si conocemos el rectángulo del campo dentro del canvas (letterbox),
       lo usamos para un mapeo exacto */
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

  /* ================ 7. DIBUJO ================ */
  const Draw = {
    line(A, B, color, width, glow, dash) {
      const ctx = Overlay.ctx;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 9; }
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    },
    circle(C, rPx, color, width, fill, glow) {
      const ctx = Overlay.ctx;
      ctx.beginPath();
      ctx.arc(C.x, C.y, rPx, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 11; }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.shadowBlur = 0;
    },

    render(M, ball, me, dt) {
      const color = CFG.style.color, w = CFG.style.width;
      const V = CFG.vis;
      if (!V.overlay) return;

      if (V.lineBallGoal && ball) {
        const gx = ball.x > CFG.worldW / 2 ? 0 : CFG.worldW;
        this.line(toScreen(M, ball), toScreen(M, { x: gx, y: CFG.worldH / 2 }), color, w, true);
        this.circle(toScreen(M, { x: gx, y: CFG.worldH / 2 }), 12, color, 2.5, null, true);
      }
      if (V.lineMeBall && me && ball) {
        this.line(toScreen(M, me), toScreen(M, ball), '#ffd94d', Math.max(2, w * 0.7), true, [8, 7]);
      }
      if (V.radius) {
        if (ball) {
          this.circle(toScreen(M, ball), (CFG.ballRadius * CFG.reachMult) * M.sx, color, 2, 'rgba(0,255,213,0.05)', true);
        }
        if (me) {
          const inRange = ball && util.dist(ball, me) <= (CFG.playerRadius + CFG.ballRadius) * 1.25;
          const rPx = (CFG.playerRadius * 1.25) * M.sx;
          this.circle(toScreen(M, me), rPx,
            inRange ? '#39ff7a' : '#ffd94d', 2, inRange ? 'rgba(57,255,122,0.10)' : 'rgba(255,217,77,0.06)', true);
        }
      }
      if (V.trajectory && ball) {
        const sp = Math.hypot(Vision.vx, Vision.vy);
        if (sp > 4) {
          const ahead = Math.min(90, sp * 0.55);
          this.line(toScreen(M, ball),
            toScreen(M, { x: ball.x + (Vision.vx / sp) * ahead, y: ball.y + (Vision.vy / sp) * ahead }),
            'rgba(255,255,255,0.85)', 1.8, true, [4, 5]);
        }
      }
      if (me) {
        const s = toScreen(M, me);
        this.circle(s, 10, '#ffffff', 2, null, true);
      }
    }
  };

  /* ================ 8. MENÚ (panel desplegable) ================ */
  const Menu = {
    el: null, root: null, open: false,

    build() {
      if (this.el && this.el.isConnected) return;
      this.el = Host.doc.createElement('div');
      this.el.style.cssText =
        'position:fixed;top:10px;right:10px;z-index:2147482601;font:12px/1.5 "Segoe UI",system-ui,sans-serif;color:#dff6f1;user-select:none;pointer-events:auto';
      this.el.innerHTML = `
        <div>
          <button data-opm="toggle" style="cursor:pointer;background:#0a121ade;border:1px solid #00ffd566;color:#00ffd5;border-radius:8px;padding:6px 10px;font-weight:700;letter-spacing:1px">🎯 OP · M</button>
        </div>
        <div data-opm="panel" style="display:none;margin-top:6px;width:250px;background:#0a121ae9;border:1px solid #00ffd544;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px #0009">
          <div data-opm="status" style="margin-bottom:8px;font-size:11px;color:#9be8d8;line-height:1.55"></div>
          <label style="display:flex;gap:8px;margin:4px 0;cursor:pointer"><input data-opm="cb" type="checkbox" data-k="lineBallGoal"> Línea balón → arco</label>
          <label style="display:flex;gap:8px;margin:4px 0;cursor:pointer"><input data-opm="cb" type="checkbox" data-k="lineMeBall"> Línea yo → balón</label>
          <label style="display:flex;gap:8px;margin:4px 0;cursor:pointer"><input data-opm="cb" type="checkbox" data-k="radius"> Radio de alcance</label>
          <label style="display:flex;gap:8px;margin:4px 0;cursor:pointer"><input data-opm="cb" type="checkbox" data-k="trajectory"> Trayectoria</label>
          <label style="display:flex;gap:8px;margin:4px 0;cursor:pointer"><input data-opm="cb" type="checkbox" data-k="demo"> Demo (sin campo)</label>
          <label style="display:flex;gap:8px;margin:4px 0;cursor:pointer"><input data-opm="cb" type="checkbox" data-k="autoMe"> "Yo" automático</label>
          <label style="display:block;margin:8px 0 2px;color:#9be8d8">Grosor
            <input data-opm="range" type="range" min="1" max="10" value="${CFG.style.width}" style="width:100%"></label>
          <div style="display:flex;gap:6px;margin:8px 0">
            ${['#00ffd5', '#ffd94d', '#ff5252', '#4d79ff', '#b24dff', '#ffffff'].map(c =>
              `<span data-opm="col" data-c="${c}" style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === CFG.style.color ? '#fff' : '#0000'}"></span>`).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button data-opm="pick" style="flex:1;cursor:pointer;background:#ffd94d22;border:1px solid #ffd94d88;color:#ffd94d;border-radius:6px;padding:5px">🎯 Soy yo</button>
            <button data-opm="kill" style="flex:1;cursor:pointer;background:#ff525222;border:1px solid #ff525288;color:#ff5252;border-radius:6px;padding:5px">✖ Apagar</button>
          </div>
        </div>`;
      Host.doc.body.appendChild(this.el);
      this.root = this.el;

      this.el.querySelector('[data-opm="toggle"]').onclick = () => this.setOpen(!this.open);
      this.el.querySelectorAll('[data-opm="cb"]').forEach(cb => {
        cb.checked = cb.dataset.k === 'autoMe' ? !!CFG.autoMe : !!CFG.vis[cb.dataset.k];
        cb.onchange = () => {
          if (cb.dataset.k === 'autoMe') { CFG.autoMe = cb.checked; persist(); }
          else { CFG.vis[cb.dataset.k] = cb.checked; persist(); }
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
      this.el.querySelector('[data-opm="pick"]').onclick = () => startPick();
      this.el.querySelector('[data-opm="kill"]').onclick = () => OpMode.destroy();
    },

    setOpen(v) {
      this.open = v;
      const p = this.el.querySelector('[data-opm="panel"]');
      const b = this.el.querySelector('[data-opm="toggle"]');
      p.style.display = v ? 'block' : 'none';
      b.textContent = v ? '▾ OP · M' : '🎯 OP · M';
    },

    status(s) { const n = this.el && this.el.querySelector('[data-opm="status"]'); if (n) n.textContent = s; }
  };

  /* Fijar "yo" con un clic sobre tu jugador */
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
    const w = ((e.clientX - M.ox) / M.sx);
    const h = ((e.clientY - M.oy) / M.sy);
    Vision.me = { world: { x: w, y: h }, pinned: true, color: 'red' };
    CFG.autoMe = false;
    persist();
    Menu.el.querySelectorAll('[data-opm="cb"]').forEach(cb => { if (cb.dataset.k === 'autoMe') cb.checked = false; });
    util.log('"Yo" fijado en (' + w.toFixed(0) + ', ' + h.toFixed(0) + ').');
  }

  /* ================ 9. FUENTE DE DATOS POR API (opcional) ================ */
  const Data = { custom: null, ball: null, me: null };

  function pollCustom() {
    if (typeof Data.custom !== 'function') return false;
    try {
      const d = Data.custom();
      if (d && d.ball && (d.ball.x != null)) {
        Data.ball = { x: d.ball.x, y: d.ball.y };
        if (d.me) Data.me = { world: { x: d.me.x, y: d.me.y }, color: d.me.team === 1 ? 'red' : 'blue', pinned: true };
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ================ 10. ATAJOS + BUCLE ================ */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const K = CFG.keys;
    const toggle = (k, label) => {
      CFG.vis[k] = !CFG.vis[k]; persist();
      const el = Menu.el && Menu.el.querySelector('[data-opm="cb"][data-k="' + k + '"]');
      if (el) el.checked = CFG.vis[k];
      util.log(label + (CFG.vis[k] ? ' ON' : ' OFF'));
    };
    switch (e.code) {
      case K.menu: Menu.setOpen(!Menu.open); break;
      case K.lbg: toggle('lineBallGoal', 'Línea balón→arco'); break;
      case K.lmb: toggle('lineMeBall', 'Línea yo→balón'); break;
      case K.radius: toggle('radius', 'Radio'); break;
      case K.traj: toggle('trajectory', 'Trayectoria'); break;
      case K.overlay: CFG.vis.overlay = !CFG.vis.overlay; persist(); util.log('Overlay ' + (CFG.vis.overlay ? 'visible' : 'oculto')); break;
    }
  }

  let lastTs = 0, tick = 0, demoTick = 0;
  let known = null;          /* última detección {ball, me, t} para dibujo continuo */

  function loop(ts) {
    requestAnimationFrame(loop);
    const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    tick++;
    demoTick++;

    try {
      Host.scan();
      Overlay.ensure();
      Menu.build();

      /* Muestreo del canvas (throttle ~30fps) */
      if (Host.canvas && tick % CFG.tickEvery === 0) {
        const data = Sampler.frame();
        if (data) {
          const ok = Vision.analyze(data, Sampler.sw, Sampler.sh);
          if (ok) {
            Vision.trackVel(Vision.ballWorld, dt);
            known = {
              ball: Vision.ballWorld,
              me: (Vision.me && Vision.me.world) ? Vision.me.world : null,
              t: ts
            };
          } else if (known && ts - known.t > 700) {
            known = null;
          }
        }
      }

      const M = buildMapping();

      /* Fuente por API custom (sobreescribe píxeles) */
      let ball = null, me = null;
      if (pollCustom()) {
        ball = Data.ball;
        me = Data.me && Data.me.world ? Data.me.world : (known ? known.me : null);
      } else if (known && ts - known.t <= 700) {
        ball = known.ball;
        me = known.me;
      }
      if (!ball && CFG.vis.demo) {
        Vision.demo(demoTick);
        ball = Vision.ballWorld;
        me = Vision.me.world || null;
      }

      /* Estado en el menú */
      const fieldTxt = Vision.field ? 'campo ✓' : 'campo ✗';
      const ballTxt = ball ? 'balón ✓' : 'sin balón';
      const meTxt = me ? 'yo ✓' : 'yo ✗';
      Menu.status((Data.custom ? 'CUSTOM · ' : 'PÍXELES · ') + fieldTxt + ' · ' + ballTxt + ' · ' + meTxt +
        (!Host.canvasRect() && !Vision.field ? ' · (sin canvas)' : ''));

      if (Overlay.ctx) {
        Overlay.sync();
        Draw.render(M, ball, me, dt);
      }
    } catch (e) { /* nunca romper el bucle */ }
  }

  /* ================ 11. API PÚBLICA ================ */
  const OpMode = {
    _opmode: true,
    get version() { return CFG.version; },

    get state() {
      return {
        source: Data.custom ? 'custom' : (Vision.field ? 'pixels' : 'none'),
        ball: Vision.ballWorld || Data.ball || null,
        me: (Vision.me && Vision.me.world) || null,
        field: !!Vision.field,
        vis: Object.assign({}, CFG.vis)
      };
    },

    toggle(what) {
      if (what in CFG.vis) { CFG.vis[what] = !CFG.vis[what]; persist(); util.log(what + ' → ' + (CFG.vis[what] ? 'ON' : 'OFF')); }
      else util.log('Opciones: lineBallGoal, lineMeBall, radius, trajectory, demo, overlay');
    },

    setMe(x, y) {
      if (typeof x === 'object' && x != null) { y = x.y; x = x.x; }
      if (!isFinite(x) || !isFinite(y)) return util.log('Uso: OpMode.setMe(x, y)');
      Vision.me = { world: { x, y }, pinned: true, color: 'red' };
      CFG.autoMe = false; persist();
      util.log('"Yo" = (' + x.toFixed(0) + ', ' + y.toFixed(0) + ')');
    },

    pickMe() { startPick(); },

    resetMe() { Vision.me = null; CFG.autoMe = true; persist(); util.log('"Yo" en automático.'); },

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
      console.log('%cM menú · N línea balón→arco · J línea yo→balón · B radio · V trayectoria · K overlay\nOpMode.toggle, setMe, pickMe, setDataSource, destroy',
        'color:#9be8d8');
    }
  };

  /* ================ ARRANQUE ================ */
  loadCfg();
  Host.init();
  Overlay.ensure();
  Menu.build();
  Host.doc.addEventListener('keydown', onKey, false);
  Host.doc.addEventListener('click', onPickClick, true);
  window.OpMode = OpMode;
  requestAnimationFrame(loop);

  util.log('v' + CFG.version + ' activado. M: menú · K: ocultar overlay · N/J/B/V: ayudas.');
  util.log('Si no ves nada aún (lobby/cargando): pulsa M y activa "Demo".');
})();