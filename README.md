# OpMode · Asistente de Cliente para Haxball (v2.0.0)

Script 100 % **lado cliente** que se pega en la consola DevTools dentro de
[`https://www.haxball.com/play`](https://www.haxball.com/play). Dibuja ayudas
visuales en tiempo real SOBRE el canvas del juego: líneas, radios, trayectoria
y un **menú desplegable** tipo "mod menu".

**v2.0.0 cambia por completo el método de datos:** el cliente oficial **no
expone ninguna API de posiciones** (lo verifiqué contra el `game-min.js`
actual: ni `Room`, ni `window.g`, ni `getBallPosition`). Por eso ahora la
detección es **por píxeles**: se lee directamente el canvas del juego y se
identifican el campo, el balón y los jugadores **sin tocar el estado del
juego**. Funciona en el cliente sin modificar.

---

## ⚠️ Aviso antes de nada

Esto es una **ayuda visual**. Dibuja encima del lienzo; no modifica físicas ni
lee memoria. Aun así:

- En **partidas clasificatorias, torneos o ligas** las asistencias y overlays
  suelen estar **prohibidos** y sancionarse. Úsalo para **entrenar**, **salas
  privadas** o **modo libre**.
- La detección por píxeles puede fallar (balón "perdido" un instante, jugador
  esquivo); no es un wallhack perfecto.

---

## ✨ Qué hace

| Ayuda | Descripción |
|---|---|
| 🎯 **Línea balón → arco** | Línea neón desde el balón hasta el arco **más lejano** (el rival), con aro en la puerta. |
| 🧭 **Línea yo → balón** | Línea amarilla desde tu jugador al balón. El "yo" se elige con un clic (**🎯 Soy yo**) o en modo automático (el jugador más cercano al balón). |
| ⭕ **Radio de alcance** | Círculo de "contacto" alrededor del balón (radio configurable) y de tu jugador (se ilumina en verde cuando estás en distancia de tiro). |
| 📈 **Trayectoria** | Segmento de puntos con la dirección estimada del balón (velocidad derivada entre frames y suavizada). |
| 🖥️ **Menú desplegable** | Panel superior derecha para activar/desactivar cada ayuda, grosor, color, modo demo y estado de la detección. |
| 🧪 **Modo demo** | Si no hay campo visible (lobby, cargando, sala con otro estadio), dibuja un partido simulado animado para que veas las líneas **funcionando ahora mismo**. |

---

## 🛠️ Instalación

### 1. Abre Haxball
Entra en [`https://www.haxball.com/play`](https://www.haxball.com/play).
Puedes pegar el script en el lobby o dentro de una sala; se auto-detecta el canvas.

### 2. Abre la consola
- **Chrome / Edge / Brave**: `F12` → pestaña **Console**.
- **Firefox**: `F12` (o `Ctrl + Shift + K`) → pestaña **Consola**.
- Si Chrome avisa *"Don't paste code you do not understand"*, pulsa **Allow pasting** una vez.

### 3. Pega el código y pulsa Enter
Abre [`opmode-hax.js`](./opmode-hax.js), cópialo **completo** y pégalo.

### 4. Verifica
Verás en consola algo como:
```
[OPMODE] v2.0.0 activado. Pulsa M para el menú, K para ocultar el overlay.
[OPMODE] Lectura por píxeles: WebGL readPixels (en tiempo real)
```
Y el botón **🎯 OP · M** arriba a la derecha. Si estás en un campo con
partida, verás las líneas; si no, enciende **Demo (sin campo)** en el menú
para ver las líneas animadas de ejemplo.

---

## ⌨️ Controles

| Tecla | Acción |
|---|---|
| **M** | Abrir / cerrar el menú desplegable |
| **N** | Línea balón → arco |
| **J** | Línea yo → balón |
| **B** | Radio de alcance (círculos) |
| **V** | Trayectoria del balón |
| **K** | Mostrar / ocultar todo el overlay |

Los atajos se ignoran mientras escribes en el chat.

### Cómo fijar "yo"
- Botón **🎯 Soy yo** del menú → haz clic sobre tu jugador en el campo. Queda
  guardado hasta recargar.
- O desde consola: `OpMode.setMe(400, 200)` / `OpMode.setMe({x: 400, y: 200})`.
- Desactiva **"Yo" automático** para que el script no lo re-identifique.

### API de consola
```js
OpMode.state                      // { source, ball, me, field, vis }
OpMode.toggle('lineBallGoal')     // 'lineBallGoal' | 'lineMeBall' | 'radius' | 'trajectory' | 'demo' | 'overlay'
OpMode.setMe(400, 200)            // fija tu posición (coords del campo)
OpMode.pickMe()                   // modo "clic sobre mi jugador"
OpMode.resetMe()                  // vuelve al modo automático
OpMode.setDataSource(fn)          // fuente de datos externa (AVANZADO, ver abajo)
OpMode.destroy()                  // apaga todo y limpia listeners
```

---

## 🔍 Cómo funciona la detección por píxeles

1. **Se localiza el canvas** del juego (el más grande, dentro del iframe
   `game.html`).
2. **Se captura un frame** en el *momento exacto*: Haxball renderiza con
   WebGL y borra el buffer tras pintar (no se puede leer con
   `getImageData`/`drawImage` desde fuera). El script envuelve el
   `requestAnimationFrame` del iframe **una sola vez**, de modo que su
   lectura (vía `gl.readPixels`) corre justo después de que el juego dibuje y
   antes de que el navegador limpie el buffer.
3. **Se baja la resolución** a una cuadrícula pequeña (~360 px de ancho) para
   analizarla a 60 fps con coste mínimo.
4. **Se detecta el campo** por su color verde dominante (autocalibrado contra
   el letterbox), **el balón** (mancha blanca compacta y redonda) y **los
   jugadores** (siluetas de color de equipo) mediante componentes conexas.
5. Esas posiciones se convierten a coordenadas de mundo (800×400) y se
   dibujan sobre el overlay.

`glEvery` y `sampleWTarget` (al inicio del script) ajustan precisión vs.
coste.

### Fallback
Si el contexto WebGL no estuviera disponible, el script intenta leer el canvas
vía `drawImage` a un canvas 2D. En cualquier caso, **no hay ningún acceso de
bajo nivel**: solo se leen los píxeles ya renderizados por el cliente.

---

## 🔌 Fuentes de datos por API (opcional / avanzado)

La lectura por píxeles es el método **por defecto y recomendado**. Además, el
script comprueba si el cliente expone una API (algún mod o herramienta) y si
es así la usa como fuente *más precisa*:

1. **Engine `g`** del iframe (tipo `client_bot_utils.js` de ChasmSolacer).
2. **Room API** (`Room`/`room` con `getPlayerList()` y `getBallPosition()`).
3. **Custom** — la que tú conectas:
   ```js
   OpMode.setDataSource(() => ({
     me:   { x: 400, y: 200, team: 1 },
     ball: { x: 300, y: 150 }
   }));
   ```
   Pasa `null` para volver a píxeles.

> ⚠️ Nota sobre **ChasmSolacer / Haxball-Client-Expansion**: su `game-min.js`
> modificado está construido para una versión antigua del bundle (hash
> `15ee796a`), y el cliente actual es otro (`0349dd60`). Puede **no** funcionar
> hoy. Por eso OpMode v2 **no depende de él**.

---

## 🐛 Solución de problemas

| Problema | Solución |
|---|---|
| No veo el botón 🎯 OP | Asegúrate de pegar en la consola de `haxball.com/play` (no en la del iframe ni en otra pestaña). Pulsa **K**. |
| Líneas no aparecen en una sala | Espera 2-3 s. Verifica en el menú el estado: *"PÍXELES (buscando campo)"* → aún no ve el campo (estadio poco habitual, fondo oscuro, letreros); activa **Demo** para confirmar que el overlay dibuja. |
| Muestra *PÍXELES · sin balón* | Hay campo pero no detecta el balón (está en zona con mucho blanco, scoreboard, descanso, etc.). Aguanta unos frames; se recupera solo. |
| El balón salta / parpadea | Es normal: la detección es por color. Sube `sampleWTarget` o baja `glEvery` para más precisión. |
| No detecta formaciones completas (jugadores) | Los avatares personalizados pueden no tener borde de color; solo se marcan los de color puro de equipo. La línea yo→balón necesita tu jugador: úsalo con **🎯 Soy yo**. |
| Atajos no responden | Haz clic dentro del campo para dar foco al iframe; el script escucha en ambos documentos. No escribas en el chat. |
| Bajo rendimiento | Reduce la lectura: sube `glEvery` a 2 o baja `sampleWTarget` a 240 (constantes al inicio del script) y desactiva ayudas que no uses. |
| No se guarda mi configuración | Los ajustes se guardan en `localStorage`. Bloqueadores/Brave Shield pueden impedirlo; no es crítico. |
| Recargué la página | La instancia murió. Vuelve a pegar el script (la configuración guardada se restaura). |
| Quiero borrarlo todo | `OpMode.destroy()` o `F5`. |

---

## 🧠 Notas técnicas

- Se envuelve el `requestAnimationFrame` del iframe (después del del juego,
  orden FIFO) para leer el buffer WebGL mientras es válido.
- El análisis usa máscaras de color + etiquetado de componentes conexas sobre
  un downsample; el campo se autocalibra cada frame (suavizado exponencial).
- El overlay es un `<canvas>` propio con `position:fixed`, `z-index` alto y
  `pointer-events:none`; no interfiere con el ratón del juego salvo en el modo
  "Soy yo" (clic puntual).
- Coordenadas: estadio estándar **800×400**; `1=Rojo`, `2=Azul`. El arco rival
  por defecto es el más alejado del balón.

---

## 📦 Contenido

```
opmode-hax/
├── opmode-hax.js    → el script (pégalo en la consola)
└── README.md        → esta guía
```

Uso libre para fines educativos y de entrenamiento, bajo tu responsabilidad.
No afiliado con Haxball ni con su equipo de desarrollo.