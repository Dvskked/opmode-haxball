# OpMode · Asistente de Cliente para Haxball

Script 100 % **lado cliente** que se inyecta desde la consola DevTools dentro de
[`https://www.haxball.com/play`](https://www.haxball.com/play). Dibuja ayudas
visuales en tiempo real sobre el canvas del juego sin modificar ni el servidor
ni el estado físico de la sala.

```
██ ██ ██ ██  ██             OP·MODE
██   ██      ██  █████  ██▀▀▀  ██▄  ██▄  ███▀
██   ██  ███  ██  ██    ██  ██ ██    ██ ▄ ██▄▄
██   ██    ██ ██  ██    ██▄▄▄ ██▄▄  ██▄▄ ██
     █████ ██        V1.0.0 · CLIENT ASSISTANT
```

---

## ⚠️ Aviso importante

Esto es una **ayuda visual** (overlay de dibujo). **No** modifica físicas, no
lee memoria del proceso ni inyecta paquetes: solo dibuja encima del lienzo del
juego usando lo que EXPONE el propio cliente. Úsalo con responsabilidad:

- No la uses en partidas clasificatorias, torneos o ligas donde los overlays
  y asistencias estén prohibidos (en competición esto puede considerarse
  trampa y suele sancionarse).
- Es ideal para **entrenar**, **salas privadas**, **modo libre** o para
  estudiar el comportamiento de la trayectoria/arcos.

---

## ✨ Funcionalidades

| Ayuda visual | Descripción |
|---|---|
| 🎯 **Línea de tiro** | Cuando el jugador local tiene el balón (o está muy cerca de él), dibuja una línea con flecha desde tu jugador hacia la **puerta rival** y un aro en el centro de esa puerta. |
| 🧭 **Guía al balón** | Si NO tienes el balón, se dibuja una guía a rayas (naranja) desde tu jugador hacia el balón para anticiparte a la jugada. |
| ⭕ **Radio de alcance/contacto** | Círculo alrededor del jugador local con radio = radio del jugador + radio del balón (la distancia a la que "tocas" el balón). Se rellena de color cuando estás en contacto. |
| 📈 **Trayectoria del balón** | Segmento de puntos extraído de la **velocidad estimada** del balón (derivada, no leída del servidor) para ver hacia dónde va. |
| 📊 **HUD discreto** | Panel semitransparente sobre el canvas que confirma que el OpMode está activo, qué fuente de datos se usa, tu jugador local y el estado de la partida. |

---

## 🛠️ Instalación paso a paso

### 1. Abre Haxball
Entra en [`https://www.haxball.com/play`](https://www.haxball.com/play) y entra
en una sala (aunque también funciona desde la lista de salas; el overlay se
monta solo cuando detecta el canvas del juego).

### 2. Abre la consola del navegador

| Navegador | Atajo |
|---|---|
| Chrome / Brave / Edge | `F12` o `Ctrl + Shift + I` |
| Firefox | `F12` o `Ctrl + Shift + K` |
| Safari (no recomendado) | `Alt + Cmd + C` |

Haz clic en la pestaña **Console / Consola**. Si hay mensajes previos, puedes
limpiarlos con el botón 🚫 del panel (opcional).

### 3. Pega el código y pulsa Enter

- Abre el archivo [`opmode-hax.js`](./opmode-hax.js).
- Cópialo **completo** y pégalo en la consola.
- Pulsa **Enter**.

> En Chrome, si pegas un bloque muy largo verás el mensaje *"Warning: Don’t
> paste code that you do not understand"*. Es normal; pulsa **Allow pasting**
> una vez si quieres, o pega en fragmentos.

### 4. Verifica que se activó

Deberías ver en la consola:

```
[OPMODE] Activado. Pulsa B para ocultar/mostrar el overlay.
```

y, cuando el juego detecte el canvas, un panel **OPMODE** en la esquina
superior izquierda del campo. Si pegas dos veces el script, no se duplica:
te avisa de que ya hay una instancia activa.

---

## ⌨️ Controles y atajos

| Tecla | Acción |
|---|---|
| **M** | Activar/desactivar las líneas de asistencia (tiro al arco + guía al balón) |
| **N** | Activar/desactivar el radio de alcance/contacto |
| **V** | Activar/desactivar la trayectoria estimada del balón |
| **B** | Mostrar/ocultar todo el overlay (HUD incluido) |

Los atajos se ignoran mientras estés escribiendo en el chat (input enfocado).

### API de consola (avanzado)

El script expone `window.OpMode` para controlarlo desde la consola:

```js
OpMode.state                 // { lines, radius, trajectory, overlay, source, me }
OpMode.toggle('line')        // alterna 'line' | 'radius' | 'trajectory' | 'overlay'
OpMode.setMe('TuNick')       // fija el jugador local por nick exacto
OpMode.setMe(7)              // o por id numérico
OpMode.calibrate(4, -2)      // ajuste fino de alineación en px (x, y)
OpMode.destroy()             // apaga todo y limpia listeners
```

---

## 🔌 Compatibilidad y fuentes de datos (cómo funciona)

El script **no lee el renderizador** a lo bruto: busca una *fuente de datos*
que el propio cliente (o modificaciones conocidas) exponen en el contexto de la
página, en este orden:

1. **Room API** → cualquier objeto global con `getPlayerList()` y
   `getBallPosition()` (p. ej. `Room`, `room`, o un objeto detectado
   automáticamente).
2. **Engine `g`** → el global `g` del motor si expone lista de jugadores y
   posición del balón.
3. **Custom** → una función que tú conectas con `OpMode.setDataSource(fn)`.

El overlay detecta el `<canvas>` más grande del documento (el escenario está
dentro de un iframe `.gameframe` del mismo origen, pero el script escanea el
documento superior y todos los iframes accesibles).

### ¿No se dibujan las líneas?

Si el HUD muestra **`SIN DATOS`**, significa que en tu navegador/versión no se
encontró ninguna fuente de datos automática. Tienes varias opciones:

**Opción A — Usa la extensión de cliente de ChasmSolacer**
[Haxball-Client-Expansion](https://github.com/ChasmSolacer/Haxball-Client-Expansion)
expone en el cliente muchas funciones del headless host (incluido el acceso a
posiciones). Con el overrider puesto, el script suele encontrar la fuente por
sí solo (navegadores Chromium).

**Opción B — Conecta tu propia fuente de datos**

```js
OpMode.setDataSource(() => {
  // Ejemplo con una variable de sala que ya tengas en la consola:
  const ball = (typeof room !== 'undefined' && room.getBallPosition)
    ? room.getBallPosition()
    : null;
  const me = /* tu jugador local: { x, y, team, name, id } */;
  return { me, ball, players: [] };   // players es opcional
});
```

La función se llama en cada frame; todo lo que devuelva se dibuja de inmediato.

### ¿Qué pasa si "mi jugador" no se detecta?

El script intenta, por este orden: `currentPlayerId`/`playerId` expuestos por la
fuente → `CFG.meId`/`CFG.meName` → coincidencia con `localStorage.player_name`
→ único jugador en la lista. Si falla, fíjalo tú:

```js
OpMode.setMe('TuNickExacto');
// o
OpMode.setMe(3);
```

---

## 🐛 Solución de problemas (FAQ)

| Problema | Solución |
|---|---|
| No veo el panel OPMODE | Asegúrate de estar en `haxball.com/play` (la consola debe ser la del juego). Pulsa **B** por si el overlay estaba oculto. Recarga la página y vuelve a pegar. |
| El panel dice `SIN DATOS` | Lee la sección *"¿No se dibujan las líneas?"*. Conéctate a una sala y espera 2-3 s (el escaneo es periódico), o usa `setDataSource`. |
| Dice `jugador no identificado` | Tu nick no coincide con `localStorage.player_name` o eres espectador. Usa `OpMode.setMe(...)`. |
| Las líneas están desalineadas | El campo dejas de encajar con el canvas (márgenes). Ajusta: `OpMode.calibrate(dx, dy)`. |
| El balón no es visible al inicio de la jugada | `getBallPosition()` devuelve `null` si el partido no está en curso; es esperado. |
| Los atajos no responden | Haz clic sobre el campo para dar foco al iframe y vuelve a intentarlo (el script escucha en ambos documentos). Verifica que no estés escribiendo en el chat. |
| Bajo rendimiento / micro-pausas | El dibujo es un canvas 2D separado y corre dentro del mismo `requestAnimationFrame`; el coste es mínimo. Si notas algo, desactiva la trayectoria (V) o el radio (N). |
| Después de cambiar de sala la UI se "rompe" | El juego a veces reconstruye el DOM; el overlay se re-monta solo en el siguiente ciclo. Si lo hubiera, recarga la página. |
| Firefox no muestra nada | Firefox es compatible, pero **Chromium (Chrome/Edge/Brave) es el escenario recomendado**: Haxball usa canvas de baja latencia y algunos hacks de exposición de API son específicos de Chromium. |
| Adblockers/extensions interfieren | Desactiva bloqueadores (incluido *Brave Shield*) para `haxball.com` y prueba de nuevo. |
| Quiero borrarlo todo | `OpMode.destroy()` o simplemente `F5` (recargar la página). |

---

## 🧠 Notas técnicas

- **Overlay**: se crea un `<canvas>` propio con `position:fixed`, `z-index` alto
  y `pointer-events:none`, anclado al rectángulo del canvas del juego.
- **Rendimiento**: el bucle usa `requestAnimationFrame` del documento del
  juego (60–120 FPS según el equipo), sin tocar el loop de render del juego.
- **Mapeo de coordenadas**: el campo estándar mide **800×400** unidades. El
  script supone que el campo completo es visible y hace un mapeo lineal
  mundo → píxel (`x` hacia abajo a la derecha, `y` hacia abajo).
- **Equipos**: `1 = Rojo` (ataca puerta x=800), `2 = Azul` (ataca puerta x=0).
  Si un estadio personalizado usa otras dimensiones/arcos, ajusta
  `CFG.attackGoal` y `CFG.worldW/H` en el código.
- **Velocidad del balón**: se estima derivando la posición entre frames y
  suavizando con media exponencial (solo visual, nunca se lee del servidor).

---

## 📦 Contenido del repositorio

```
opmode-hax/
├── opmode-hax.js    → el script (pégalo en la consola)
└── README.md        → esta guía
```

---

## 📄 Licencia y exención

Uso libre para fines educativos y de entrenamiento, bajo tu responsabilidad.
No afiliado con Haxball ni con su equipo de desarrollo. Haxball es una marca de
su respectivo propietario.