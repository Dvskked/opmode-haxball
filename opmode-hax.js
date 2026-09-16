/* ======================================================================
   OpMode · Haxball Client Assistant   ·   v1.0.0
   ----------------------------------------------------------------------
   Script 100% cliente, pensado para pegar directamente en la consola
   DevTools (F12) dentro de https://www.haxball.com/play

   Funcionalidades:
     - Línea de tiro hacia la puerta rival cuando el jugador local está
       en contacto (o muy cerca) del balón.
     - Guía a rayas hacia el balón cuando NO se tiene la posesión.
     - Radio de alcance / contacto (del balón respecto al jugador local).
     - Trayectoria estimada del balón (derivada de su velocidad).
     - HUD discreto dibujado sobre el canvas con el estado del OpMode.

   Atajos por defecto:
     M  ... alterna líneas de asistencia (tiro + guía)
     N  ... alterna el radio de alcance/contacto
     V  ... alterna la trayectoria estimada del balón
     B  ... muestra / oculta todo el overlay

   API pública en consola: window.OpMode
     OpMode.setMe('nick' | id)      → fija manualmente el jugador local
     OpMode.setDataSource(fn)       → enchufa una fuente de datos propia
     OpMode.toggle('lineo'...)      → alterna una ayuda concreta
     OpMode.calibrate(dx, dy)       → ajuste fino de alineación (px)
     OpMode.destroy()               → elimina el overlay y los listeners

   IMPORTANTE: es una ayuda VISUAL únicamente; no toca el estado del
   servidor ni el motor físico de la sala.
   ====================================================================== */
(() => {
  'use strict';

  /* Ya hay una instancia ejecutándose */
  if (window.OpMode && window.OpMode._opmode) {
    console.warn('[OpMode] Ya hay una instancia activa. Usa OpMode.destroy() y vuelve a pegar.');
    return;
  }

  /* ================ 1. CONFIGURACIÓN ================ */
  const CFG = {
    version: '1.0.0',

    /* Dimensiones del campo en "unidades del mundo" (estadio estándar) */
    worldW: 800,
    worldH: 400,

    /* Radios físicos por defecto (tu unidad local puede cambiarlos) */
    ballRadius: 10,
    playerRadius: 15,

    /* Margen extra para considerar el balón "nuestro" (u) */
    ownTolerance: 30,

    /* Puerta rival según tu equipo: 1 = Rojo (ataca x=800), 2 = Azul (ataca x=0) */
    attackGoal: {
      1: { x: 800, y: 200 },
      2: { x: 0,   y: 200 }
    },

    /* Colores de las ayudas */
    colors: {
      line:        '#00e5ff',   /* línea de tiro al arco rival */
      guide:       '#ffb300',   /* guía de aproximación al balón */
      radius:      'rgba(0,229,255,0.60)',
      radiusFill:  'rgba(0,229,255,0.07)',
      trajectory:  'rgba(255,255,255,0.45)',
      marker:      '#ff5252',
      owned:       '#33ff77',   /* resaltado de "tengo el balón" */
      hudBg:       'rgba(10,18,26,0.62)',
      hudText:     '#e8f4f8'
    },

    /* Atajos (se usa KeyboardEvent.code) */
    keys: {
      line:       'KeyM',
      radius:     'KeyN',
      trajectory: 'KeyV',
      overlay:    'KeyB'
    },

    /* Identificación manual del jugador local (opcional, nulo = automático) */
    meId: null,
    meName: null,

    /* Ajuste fino (px) si el campo no ocupa exactamente todo el canvas */
    calX: 0,
    calY: 0,

    /* Intervalos de actualización (ms) */
    scanCanvasMs: 800,
    scanRoomMs: 2000
  };

  /* ================ utilidades ================ */
  const util = {
    styleInfo: 'color:#00e5ff;font-weight:bold;background:#0a121a;padding:2px 6px;border-radius:3px',
    log(msg) {
      console.log('%c[OPMODE] ' + msg, this.styleInfo);
    },
    isNum(n) {
      return typeof n === 'number' && isFinite(n);
    },
    pt(x, y) {
      return { x: +x, y: +y };
    },
    normalizePoint(p) {
      if (!p) return null;
      if (Array.isArray(p)) return this.pt(p[0], p[1]);
      if (p.position) return this.pt(p.position.x, p.position.y);
      if (this.isNum(p.x) && this.isNum(p.y)) return this.pt(p.x, p.y);
      return null;
    },
    /* ¿El objeto parece una Room (API headless/host)? */
    isRoomLike(v) {
      try {
        return !!v && typeof v === 'object' &&
          typeof v.getPlayerList === 'function' &&
          typeof v.getBallPosition === 'function';
      } catch (e) { return false; }
    },
    /* ¿El objeto parece el global `g` del motor (con state expuesto)? */
    isGLike(v) {
      try {
        return !!v && typeof v === 'object' &&
          typeof v.getPlayerList === 'function' &&
          (typeof v.getBallPosition === 'function' || typeof v.getBall === 'function');
      } catch (e) { return false; }
    }
  };

  /* ================ 2. DESCUBRIMIENTO DEL DOCUMENTO / CANVAS ================ */
  /*
     El juego vive dentro de un iframe `.gameframe` (mismo origen), pero por
     robustez escaneamos el documento superior y todos los iframes accesibles
     buscando el <canvas> más grande (el escenario).
  */
  const GameFrame = {
    hostDoc: null,   /* documento donde se montará nuestro overlay */
    canvas: null,    /* <canvas> del juego (solo lectura)          */
    lastScan: 0,
    warned: false,

    bestCanvasIn(doc) {
      try {
        const list = doc.querySelectorAll('canvas');
        let best = null;
        let bestArea = 0;
        for (const c of list) {
          const r = c.getBoundingClientRect();
          const a = r.width * r.height;
          if (a >= 40000 && a > bestArea) {   /* pide área mínima ~200x200 */
            bestArea = a;
            best = c;
          }
        }
        return best;
      } catch (e) { return null; }
    },

    /* Devuelve { doc, canvas } del escenario o { doc } sin canvas */
    locate() {
      const docs = [document];
      try {
        for (const f of document.querySelectorAll('iframe, frame')) {
          const d = f.contentDocument || (f.contentWindow && f.contentWindow.document);
          if (d && d !== document) docs.push(d);
        }
      } catch (e) { /* iframe cross-origin: se ignora */ }

      let bestDoc = null;
      let bestCanvas = null;
      let bestArea = 0;
      for (const d of docs) {
        const c = this.bestCanvasIn(d);
        if (!c) continue;
        const r = c.getBoundingClientRect();
        const a = r.width * r.height;
        /* sesgo leve hacia el canvas actual para evitar parpadeo entre iguales */
        if (c === this.canvas) a *= 1.05;
        if (a > bestArea) {
          bestArea = a;
          bestCanvas = c;
          bestDoc = d;
        }
      }
      if (bestCanvas) return { doc: bestDoc, canvas: bestCanvas };

      /* Sin canvas: preferimos el documento del gameframe si existe */
      const gf = document.querySelector('iframe.gameframe');
      try {
        if (gf) {
          const d = gf.contentDocument || (gf.contentWindow && gf.contentWindow.document);
          if (d) return { doc: d, canvas: null };
        }
      } catch (e) { /* nada */ }
      return { doc: document, canvas: null };
    },

    update(force) {
      const now = Date.now();
      if (!force && now - this.lastScan < CFG.scanCanvasMs) return;
      this.lastScan = now;
      const found = this.locate();
      if (found.canvas !== this.canvas || found.doc !== this.hostDoc) {
        this.canvas = found.canvas || null;
        if (found.doc) this.hostDoc = found.doc;
        Overlay.rebase(this.hostDoc);              /* (re)monta nuestro overlay */
        if (this.canvas === null && !this.warned) {
          this.warned = true;
          util.log('Escenario no detectado todavía. Entra en una sala cuando esté listo.');
        }
        if (this.canvas) this.warned = false;
      }
    }
  };

  /* ================ 3. OVERLAY (canvas propio, invisible al ratón) ================ */
  const Overlay = {
    canvas: null,
    ctx: null,
    doc: null,
    cssW: 0,
    cssH: 0,

    createIn(doc) {
      this.canvas = doc.createElement('canvas');
      this.canvas.setAttribute('data-opmode', '1');
      this.canvas.style.position = 'fixed';
      this.canvas.style.left = '0';
      this.canvas.style.top = '0';
      this.canvas.style.zIndex = '2147482600';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.imageRendering = 'auto';
      doc.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.doc = doc;
    },

    remove() {
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = null;
      this.ctx = null;
      this.doc = null;
    },

    /* Si el documento cambió o el nodo fue eliminado, lo recreamos */
    rebase(doc) {
      if (!doc || !doc.body) return;
      if (this.canvas && this.canvas.isConnected && this.doc === doc) return;
      this.remove();
      try { this.createIn(doc); } catch (e) { this.canvas = null; }
    },

    /* Ajusta tamaño y posición (coordenadas "fixed" del mismo documento) */
    sync() {
      if (!this.canvas || !this.doc) return;
      let w, h, left, top;
      const cvs = GameFrame.canvas;
      if (cvs && cvs.isConnected) {
        const r = cvs.getBoundingClientRect();
        w = r.width; h = r.height; left = r.left; top = r.top;
      } else {
        const vw = this.doc.defaultView || window;
        w = vw.innerWidth; h = vw.innerHeight; left = 0; top = 0;
      }
      if (!w || !h) return;

      const dpr = (this.doc.defaultView && this.doc.defaultView.devicePixelRatio) || 1;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (this.canvas.width !== pw) this.canvas.width = pw;
      if (this.canvas.height !== ph) this.canvas.height = ph;

      this.cssW = w;
      this.cssH = h;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.canvas.style.left = left + 'px';
      this.canvas.style.top = top + 'px';

      /* La transformación mundo → pantalla (campo completo visible) */
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, w, h);
    },

    get raw() {
      return this.canvas || null;
    }
  };

  /* ================ 4. FUENTE DE DATOS (estado del mundo) ================ */
  const Data = {
    kind: 'none',       /* 'room' | 'g' | 'custom' | 'none' */
    src: null,
    custom: null,       /* fn() -> { me, ball, players } provisionada por el usuario */
    lastScan: 0,

    me: null,           /* jugador local (objeto del juego) */
    players: [],        /* lista de jugadores */
    ball: null,         /* {x, y} */

    vx: 0,              /* velocidad estimada del balón (u/s) */
    vy: 0,
    lastBall: null,
    lastDt: 0,

    /* --- detección automática de la API --- */
    scanIn(win) {
      try {
        for (const n of ['Room', 'room', 'hbRoom', 'ROOM', 'hostRoom']) {
          const v = win[n];
          if (util.isRoomLike(v)) return { kind: 'room', src: v };
        }
        for (const k of Object.keys(win)) {
          let v;
          try { v = win[k]; } catch (e) { continue; }
          if (v && typeof v === 'object' && util.isRoomLike(v)) {
            return { kind: 'room', src: v };
          }
        }
      } catch (e) { /* documento en reparación */ }
      return null;
    },

    scanG(win) {
      try {
        const g = win.g;
        if (util.isGLike(g)) return { kind: 'g', src: g };
      } catch (e) { /* nada */ }
      return null;
    },

    detect() {
      if (this.custom) { this.kind = 'custom'; return; }
      const now = Date.now();
      const found = this.kind !== 'none';
      if (now - this.lastScan < (found ? 4000 : CFG.scanRoomMs)) return;
      this.lastScan = now;

      if (this.src) {
        /* verificación barata de que el handle sigue vivo */
        const still = util.isRoomLike(this.src) && this.kind === 'room';
        const stillG = util.isGLike(this.src) && this.kind === 'g';
        if (still || stillG) return;
        this.src = null;
        this.kind = 'none';
      }

      const wins = [];
      const gw = GameFrame.hostDoc && GameFrame.hostDoc.defaultView;
      if (gw) wins.push(gw);
      if (window !== gw) wins.push(window);

      for (const w of wins) {
        const hit = this.scanIn(w);
        if (hit) {
          this.kind = hit.kind;
          this.src = hit.src;
          util.log('Fuente de datos detectada: ' + (this.kind === 'room' ? 'Room API' : 'motor g'));
          return;
        }
      }
      for (const w of wins) {
        const hit = this.scanG(w);
        if (hit) {
          this.kind = hit.kind;
          this.src = hit.src;
          util.log('Fuente de datos detectada: global g del motor');
          return;
        }
      }
      this.kind = 'none';
    },

    /* --- lectura del estado --- */
    poll(dt) {
      this.detect();

      if (this.custom) {
        try {
          const d = this.custom();
          if (d && typeof d === 'object') {
            const bp = util.normalizePoint(d.ball);
            if (bp) this.ball = bp;
            const mp = util.normalizePoint(d.me);
            if (mp) {
              this.me = d.me;
              if (!this.me.position) this.me = { position: mp, team: d.team, name: d.name, id: d.id };
              this.players = Array.isArray(d.players) ? d.players : [];
            }
          }
        } catch (e) { /* fuente custom con error: se ignora */ }
        this.updateBallVel(dt);
        return;
      }

      if (!this.src) { this.ball = null; this.me = null; this.players = []; return; }

      try {
        if (this.kind === 'room') {
          const pl = this.src.getPlayerList();
          this.players = (pl && typeof pl.map === 'function') ? pl.slice() : [];
          const b = this.src.getBallPosition();
          if (b) this.ball = util.normalizePoint(b);

          let myId = null;
          try { myId = this.src.currentPlayerId; } catch (e) {}
          if (myId == null) { try { myId = this.src.playerId; } catch (e) {} }
          this.me = this.resolveMe(myId);
        } else if (this.kind === 'g') {
          const pl = this.src.getPlayerList();
          this.players = (pl && typeof pl.map === 'function') ? pl.slice() : [];

          let b = null;
          try { b = this.src.getBallPosition ? this.src.getBallPosition() : null; } catch (e) {}
          if (b == null) { try { b = this.src.getBall ? this.src.getBall() : null; } catch (e) {} }
          if (b) this.ball = util.normalizePoint(b);
          if (this.ball == null) {
            try {
              const st = this.src.room && this.src.room.roomState;
              const bb = st && st.game && st.game.ball;
              if (bb) this.ball = util.normalizePoint(bb);
            } catch (e) {}
          }

          let myId = null;
          try { myId = this.src.playerId; } catch (e) {}
          if (myId == null) { try { myId = this.src.currentPlayerId; } catch (e) {} }
          this.me = this.resolveMe(myId);
        }
      } catch (e) {
        /* llama transitoria (se abandona la sala, cambio de documento...) */
      }

      this.updateBallVel(dt);
    },

    /* Identificar al jugador local con la cadena de información disponible */
    resolveMe(clueId) {
      const pl = this.players;
      if (!pl || !pl.length) return null;

      if (clueId != null) {
        const p = pl.find(q => q && q.id === clueId);
        if (p) return p;
      }
      if (CFG.meId != null) {
        const p = pl.find(q => q && q.id === CFG.meId);
        if (p) return p;
      }
      if (CFG.meName) {
        const p = pl.find(q => q && q.name === CFG.meName);
        if (p) return p;
      }
      /* Heurística: tu nick suele guardarse en localStorage.player_name */
      try {
        const w = GameFrame.hostDoc ? GameFrame.hostDoc.defaultView : window;
        const myName = w.localStorage && w.localStorage.player_name;
        if (myName) {
          const p = pl.find(q => q && q.name === myName && q.position);
          if (p) return p;
        }
      } catch (e) { /* sin acceso */ }
      if (pl.length === 1 && pl[0].position) return pl[0];
      return null;
    },

    /* Estimación sencilla de velocidad del balón con suavizado */
    updateBallVel(dt) {
      if (!this.ball) { this.lastBall = null; this.vx = 0; this.vy = 0; return; }
      if (this.lastBall) {
        const dx = this.ball.x - this.lastBall.x;
        const dy = this.ball.y - this.lastBall.y;
        if (dt > 0 && dt < 0.25 && util.isNum(dx) && util.isNum(dy)) {
          const ivx = dx / dt;
          const ivy = dy / dt;
          const a = 0.35;                            /* suavizado exponencial */
          this.vx += a * (ivx - this.vx);
          this.vy += a * (ivy - this.vy);
        }
      }
      this.lastBall = { x: this.ball.x, y: this.ball.y };
    },

    hasBallVel() {
      return util.isNum(this.vx) && util.isNum(this.vy) &&
        Math.hypot(this.vx, this.vy) > 6;
    }
  };

  /* ================ 5. DIBUJO ================ */
  const Draw = {
    T: { sx: 1, sy: 1 },   /* transformación mundo → pantalla */

    transform() {
      this.T.sx = Overlay.cssW / CFG.worldW;
      this.T.sy = Overlay.cssH / CFG.worldH;
    },

    toScreen(x, y) {
      return { x: x * this.T.sx + CFG.calX, y: y * this.T.sy + CFG.calY };
    },

    ctx() {
      return Overlay.ctx;
    },

    /* línea entre dos puntos del mundo */
    worldLine(a, b, color, width, dash) {
      const ctx = this.ctx();
      const A = this.toScreen(a.x, a.y);
      const B = this.toScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    },

    /* flecha desde ball hacia goal + cabeza de flecha */
    worldArrow(a, b, color, width) {
      const ctx = this.ctx();
      const A = this.toScreen(a.x, a.y);
      const B = this.toScreen(b.x, b.y);
      const ang = Math.atan2(B.y - A.y, B.x - A.x);
      const head = 10;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(B.x, B.y);
      ctx.lineTo(B.x - head * Math.cos(ang - 0.4), B.y - head * Math.sin(ang - 0.4));
      ctx.moveTo(B.x, B.y);
      ctx.lineTo(B.x - head * Math.cos(ang + 0.4), B.y - head * Math.sin(ang + 0.4));
      ctx.stroke();
    },

    /* círculo de radio mundo (se dibuja como elipse si la escala es distinta) */
    worldCircle(c, rWorld, color, width, fill) {
      const ctx = this.ctx();
      const C = this.toScreen(c.x, c.y);
      const rx = rWorld * this.T.sx;
      const ry = rWorld * this.T.sy;
      ctx.beginPath();
      ctx.ellipse(C.x, C.y, rx, ry, 0, 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    },

    worldCross(p, color, size) {
      const ctx = this.ctx();
      const s = this.toScreen(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x - size, s.y); ctx.lineTo(s.x + size, s.y);
      ctx.moveTo(s.x, s.y - size); ctx.lineTo(s.x, s.y + size);
      ctx.stroke();
    },

    hud(lines) {
      const ctx = this.ctx();
      const w = Overlay.cssW;
      if (w < 220) return;
      const fs = Math.max(11, Math.min(14, w / 90));
      ctx.font = '600 ' + fs + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'top';

      const pad = 8;
      const lh = fs + 6;
      const bw = w * 0.62;
      const bh = pad * 2 + lines.length * lh;

      ctx.fillStyle = CFG.colors.hudBg;
      this.rr(pad, pad, bw, bh, 6);
      ctx.fill();

      ctx.fillStyle = CFG.colors.hudText;
      lines.forEach((txt, i) => {
        ctx.fillText(txt, pad * 2, pad + 3 + i * lh);
      });
    },

    /* rectángulo redondeado */
    rr(x, y, w, h, r) {
      const ctx = this.ctx();
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },

    /* ciclo principal de render del overlay */
    render(dt) {
      if (!Overlay.ctx) return;
      Overlay.sync();                     /* posición + clear */
      const ctx = Overlay.ctx;
      if (!ctx) return;
      this.transform();

      const vis = Vis;
      if (!vis.overlay) return;

      const me = Data.me;
      const ball = Data.ball;
      const mp = me && me.position ? util.normalizePoint(me) : null;

      /* --- estado de juego / HUD --- */
      const srcLabel = Data.kind === 'custom' ? 'CUSTOM' :
                       Data.kind === 'room'   ? 'ROOM API' :
                       Data.kind === 'g'      ? 'ENGINE g' : 'SIN DATOS';
      const meLabel = me ? (me.name || '#local') + (me.team ? (' · T' + me.team) : '') : 'jugador no identificado';
      const lineOn = vis.line ? 'ON'  : 'OFF';
      const radOn  = vis.radius ? 'ON' : 'OFF';
      const traOn  = vis.trajectory ? 'ON' : 'OFF';

      const hud = [
        'OPMODE v' + CFG.version + '  ·  M:líneas[' + lineOn + ']  N:radio[' + radOn + ']  V:tray[ ' + traOn + ']',
        'Datos: ' + srcLabel + '  ·  ' + meLabel,
        ''
      ];

      if (!mp) {
        hud[2] = 'Esperando al jugador local… (si falla: OpMode.setMe("tnick"))';
        this.hud(hud);
        return;
      }
      if (!ball) {
        hud[2] = 'Sin partida en curso (el balón no está en juego).';
        this.hud(hud);
        return;
      }

      const reach = CFG.playerRadius + CFG.ballRadius;
      const dMeBall = Math.hypot(ball.x - mp.x, ball.y - mp.y);
      const owns = dMeBall <= reach + CFG.ownTolerance;
      const teamLarge = (me.team === 1 || me.team === 2);
      const goal = teamLarge ? CFG.attackGoal[me.team] : null;

      /* --- radio de alcance / contacto --- */
      if (vis.radius) {
        this.worldCircle(mp, reach, CFG.colors.radius, 1.6,
          owns ? CFG.colors.radiusFill : null);
      }

      /* --- marcador del balón + trayectoria --- */
      this.worldCross(ball, CFG.colors.marker, 4);
      if (vis.trajectory && Data.hasBallVel()) {
        const len = Math.min(260, Math.max(50, Math.hypot(Data.vx, Data.vy) * 0.14));
        const n = Math.hypot(Data.vx, Data.vy) || 1;
        const end = {
          x: ball.x + (Data.vx / n) * len * 0.35,
          y: ball.y + (Data.vy / n) * len * 0.35
        };
        /* trazado completo de la predicción (segmento) */
        this.worldLine(ball, end, CFG.colors.trajectory, 1.5, [4, 6]);
      }

      /* --- línea de asistencia --- */
      if (vis.line) {
        if (owns && goal) {
          this.worldArrow(mp, goal, CFG.colors.line, 2.2);
          this.worldCircle(goal, 6, CFG.colors.line, 1.4, null);
        } else if (!owns) {
          this.worldLine(mp, ball, CFG.colors.guide, 1.8, [8, 6]);
        }
      }

      /* --- resaltado cuando se posee el balón --- */
      if (owns) this.worldCircle(ball, 6, CFG.colors.owned, 1.8, null);

      /* --- HUD de estado --- */
      hud[2] = owns && goal
        ? 'BALÓN EN TU PODER → tira al arco (' + goal.x + ', ' + goal.y + ')'
        : 'A la caza del balón (' + ball.x.toFixed(0) + ', ' + ball.y.toFixed(0) + ')';
      this.hud(hud);
    }
  };

  /* ================ 6. ESTADO DE LAS AYUDAS ================ */
  const Vis = { line: true, radius: true, trajectory: true, overlay: true };

  /* ================ 7. BUCLE PRINCIPAL (rAF) ================ */
  const Loop = {
    rafId: null,
    running: false,
    lastTs: 0,

    raf() {
      const w = Overlay.doc && Overlay.doc.defaultView;
      return (w && w.requestAnimationFrame) ? w.requestAnimationFrame.bind(w)
                                            : (window.requestAnimationFrame.bind(window) || ((cb) => setTimeout(cb, 16)));
    },

    start() {
      if (this.running) return;
      this.running = true;
      this.lastTs = 0;
      const self = this;
      const step = (ts) => {
        if (!self.running) return;
        self.rafId = self.raf()(step);
        const dt = self.lastTs ? Math.min(0.1, (ts - self.lastTs) / 1000) : 0.016;
        self.lastTs = ts;
        try {
          GameFrame.update();
          Data.poll(dt);
          Draw.render(dt);   /* Overlay.sync() + dibujo */
        } catch (e) { /* nunca romper el bucle */ }
      };
      this.rafId = this.raf()(step);
    },

    stop() {
      this.running = false;
      if (this.rafId != null) {
        const w = Overlay.doc && Overlay.doc.defaultView;
        const cancel = (w && w.cancelAnimationFrame) ? w.cancelAnimationFrame.bind(w) : cancelAnimationFrame;
        try { cancel(this.rafId); } catch (e) {}
        this.rafId = null;
      }
    }
  };

  /* ================ 8. ATALOS DE TECLADO ================ */
  const Keys = {
    handled: {},

    onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const now = Date.now();
      if (now - (this.handled[e.code] || 0) < 80) return;   /* dedupe top/iframe */
      this.handled[e.code] = now;

      const K = CFG.keys;
      const toggle = (k, label) => {
        Vis[k] = !Vis[k];
        util.log(label + ' → ' + (Vis[k] ? 'ON' : 'OFF'));
      };
      if (e.code === K.line) toggle('line', 'Líneas de asistencia');
      else if (e.code === K.radius) toggle('radius', 'Radio de alcance');
      else if (e.code === K.trajectory) toggle('trajectory', 'Trayectoria del balón');
      else if (e.code === K.overlay) toggle('overlay', 'Overlay visible');
    },

    attach() {
      /* El juego puede capturar el foco dentro del iframe: escuchamos en
         ambos mundos (top e iframe) y deduplicamos por timestamp. */
      const w = Overlay.doc && Overlay.doc.defaultView;
      if (w && w !== window && w.addEventListener) w.addEventListener('keydown', this.onKey.bind(this), false);
      window.addEventListener('keydown', this.onKey.bind(this), false);
      this._w = w;
    },

    detach() {
      if (this._w && this._w !== window) this._w.removeEventListener('keydown', this.onKey.bind(this), false);
      window.removeEventListener('keydown', this.onKey.bind(this), false);
    }
  };

  /* ================ 9. ARRANQUE + API PÚBLICA ================ */
  const OpMode = {
    _opmode: true,
    version: CFG.version,

    get state() {
      return {
        lines: Vis.line,
        radius: Vis.radius,
        trajectory: Vis.trajectory,
        overlay: Vis.overlay,
        source: Data.kind,
        me: Data.me ? (Data.me.name || 'local') : null
      };
    },

    toggle(what) {
      if (what in Vis) {
        Vis[what] = !Vis[what];
        util.log(what + ' → ' + (Vis[what] ? 'ON' : 'OFF'));
      } else {
        util.log('Ayuda desconocida: ' + what + ' (line, radius, trajectory, overlay)');
      }
    },

    /* Fijar manualmente el jugador local (nick exacto o id numérico) */
    setMe(idOrName) {
      if (typeof idOrName === 'number') {
        CFG.meId = idOrName;
        CFG.meName = null;
      } else {
        CFG.meName = String(idOrName);
        CFG.meId = null;
      }
      util.log('Jugador local fijado a: ' + idOrName);
    },

    /* Enchufar una fuente de datos propia:
         OpMode.setDataSource(() => ({
           me: { x, y, team, name, id },
           ball: { x, y },
           players: []
         }));
       Devuelve null para desactivarla. */
    setDataSource(fn) {
      Data.custom = (typeof fn === 'function') ? fn : null;
      if (Data.custom) { Data.kind = 'custom'; util.log('Fuente de datos personalizada activada.'); }
      else { Data.kind = 'none'; util.log('Fuente de datos personalizada desactivada.'); }
    },

    calibrate(dx, dy) {
      CFG.calX = +dx || 0;
      CFG.calY = +dy || 0;
      util.log('Calibración → x:' + CFG.calX + ' y:' + CFG.calY);
    },

    destroy() {
      Loop.stop();
      Keys.detach();
      Overlay.remove();
      if (window.OpMode === OpMode) delete window.OpMode;
      util.log('Apagado. Recarga la página para un reinicio limpio.');
    },

    start() {
      util.log('Activado. Pulsa B para ocultar/mostrar el overlay.');
      GameFrame.update(true);   /* localiza doc/canvas de inmediato */
      Overlay.rebase(GameFrame.hostDoc || document);
      Keys.attach();
      Loop.start();
    }
  };

  window.OpMode = OpMode;
  OpMode.start();
})();