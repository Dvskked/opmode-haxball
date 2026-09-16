# OpMode · Asistente de Cliente para Haxball (v3.0.0)

Script 100 % **lado cliente** que se pega en la consola DevTools dentro de
[`https://www.haxball.com/play`](https://www.haxball.com/play). Dibuja ayudas
visuales sobre el canvas del juego —líneas, radios, trayectoria— y un **menú
desplegable** para activarlas.

> **v3** usa el método correcto de lectura. El cliente oficial **no expone
> ninguna API de posiciones** (se verificó contra su `game-min.js`). Además
> renderiza con un **canvas 2D**, no WebGL. v2 asumía WebGL (hook de rAF +
> `readPixels` completo): por eso **no dibujaba nada y bajaba los FPS**. v3
> hace un `drawImage`→`getImageData` a **baja resolución** (~320 px de ancho,
> acelerado por GPU, ~2-3 MB/s) cada 2 frames: **coste mínimo, sin tocar el
> loop del juego**.

---

## ⚠️ Aviso

Es una **ayuda visual** (dibuja encima del lienzo; no modifica físicas ni
memoria). En **torneos, ligas o clasificatorias** los overlays suelen estar
**prohibidos** y sancionarse. Úsalo para **entrenar**, **salas privadas** o
**modo libre**. La detección por píxeles es aproximada: puede perder el balón
un instante.

---

## ✨ Qué hace

| Ayuda | Descripción |
|---|---|
| 🎯 **Línea balón → arco** | Línea neón desde el balón al arco **más lejano**, con aro en la puerta. |
| 🧭 **Línea yo → balón** | Línea amarilla de tu jugador al balón. "Yo" = botón **🎯 Soy yo** (clic sobre tu avatar) o automático (el más cercano al balón). |
| ⭕ **Radio de alcance** | Círculo de contacto alrededor del balón y de tu jugador (verde = en distancia de tiro). |
| 📈 **Trayectoria** | Segmento con la dirección estimada del balón (velocidad derivada). |
| 🧪 **Demo** | Si no hay campo visible (lobby, cargando), dibuja un partido simulado animado para ver las líneas al instante. |
| 🖥️ **Menú (M)** | Toggles de ayudas, grosor, color, estado de detección, "Soy yo" y apagado. |

---

## 🛠️ Instalación

1. Entra en [`https://www.haxball.com/play`](https://www.haxball.com/play).
   Puedes pegar **en la consola de la página principal** o **dentro del
   iframe del juego**: el script se auto-adapta al documento de nivel superior.
2. `F12` → pestaña **Console**. (Chrome: si avisa *"Don't paste code you do
   not understand"*, pulsa **Allow pasting** una vez.)
3. Abre [`opmode-hax.js`](./opmode-hax.js), cópialo **completo** y pégalo +
   Enter.
4. Verás el botón **🎯 OP · M** arriba a la derecha. En una sala verás las
   líneas; si no, pulsa **M** y activa **Demo** para confirmar que el overlay
   dibuja (funciona también en el lobby).

---

## ⌨️ Controles

| Tecla | Acción |
|---|---|
| **M** | Abrir / cerrar menú |
| **N** | Línea balón → arco |
| **J** | Línea yo → balón |
| **B** | Radio de alcance |
| **V** | Trayectoria |
| **K** | Mostrar / ocultar todo el overlay |

### Fijar "yo"
- Menú → **🎯 Soy yo** → clic sobre tu avatar.
- O `OpMode.setMe(400, 200)` / `OpMode.setMe({x: 400, y: 200})`.
- `OpMode.resetMe()` vuelve a modo automático.

### API
```js
OpMode.state                    // { source, ball, me, field, vis }
OpMode.toggle('lineBallGoal')   // 'lineBallGoal' | 'lineMeBall' | 'radius' | 'trajectory' | 'demo' | 'overlay'
OpMode.pickMe() / OpMode.setMe(x,y) / OpMode.resetMe()
OpMode.setDataSource(fn)        // fuente externa { me:{x,y,team}, ball:{x,y} } · null para volver a píxeles
OpMode.destroy()                // apaga todo
```

---

## 🔍 Cómo funciona (y por qué no baja los FPS)

1. Se localiza el `<canvas>` 2D del juego (el más grande; si está vacío,
   prueba el siguiente candidato).
2. Cada 2 frames se copia a un canvas de caché con `drawImage` a **~320 px**
   de ancho (escala hecha por la GPU) y se lee `getImageData` de esa miniatura
   (~200 KB por lectura, no 8 MB). **No se usa `readPixels` ni se toca el
   `requestAnimationFrame` del juego.**
3. Sobre la miniatura se detecta el **campo** por su verde (con EMA para que
   no vibre), el **balón** (mancha blanca compacta/redonda con continuidad
   temporal) y los **jugadores** (manchas rojas/azules).
4. Se mapea a coordenadas de mundo (800×400) y se dibuja sobre un canvas
   overlay (`position:fixed`, `pointer-events:none`). El letterbox se corrige
   gracias al rectángulo verde detectado.

Ajustes de rendimiento/precisión al inicio del script:
- `sampleWTarget` (ancho del análisis, 320 por defecto).
- `tickEvery` (análisis cada N frames; 2 ≈ 30 fps de lectura, invisibles).

---

## 🔌 Fuente de datos por API (opcional)

La detección por píxeles es la **única que funciona en el cliente oficial sin
modificar** (comprobado: `game-min.js` actual no expone `Room`/`g`/etc.;
ChasmSolacer está desactualizado para este bundle). Aun así puedes enchufar tu
propia fuente:

```js
OpMode.setDataSource(() => ({
  me:   { x: 400, y: 200, team: 1 },
  ball: { x: 300, y: 150 }
}));
```

---

## 🐛 Solución de problemas

| Problema | Solución |
|---|---|
| No veo el botón 🎯 OP | Pégaste en la consola equivocada (otra pestaña/dominio). Pega en `haxball.com/play`, cualquiera de sus documentos (o ambos). Pulsa **K** por si estaba oculto. |
| Líneas no aparecen en sala | Espera 2-3 s; mira el **estado del menú**: `campo ✗` = no detecta el estadio (verde claro/oscuro raro): activa **Demo**; `campo ✓ · sin balón` = espera a que el balón esté visible y quieto cerca del medio. |
| Demo SÍ se ve pero en la sala no | El campo/balón tiene colores que no encajan con los umbrales. Dime el estadio y ajusto `detectField`/`detectBall`, o usa `OpMode.setDataSource`. |
| El balón parpadea | Sube `sampleWTarget` o baja `tickEvery` a 1. |
| No detecta mi jugador (yo ✗) | Usa **🎯 Soy yo** (clic sobre tu avatar). La detección automática necesita que el avatar tenga borde de color de equipo. |
| ¿FPS? | Este método NO lee el canvas completo ni intercepta el loop del juego. Si notaras algo, sube `tickEvery` a 3. |
| Recargué la página | Vuelve a pegar el script (la configuración se conserva en `localStorage`). |
| Borrarlo todo | `OpMode.destroy()` o `F5`. |

---

## 📦 Contenido

```
opmode-hax/
├── opmode-hax.js    → el script (pégalo en la consola)
└── README.md        → esta guía
```

Uso libre para fines educativos y de entrenamiento, bajo tu responsabilidad.
No afiliado con Haxball ni con su equipo de desarrollo.