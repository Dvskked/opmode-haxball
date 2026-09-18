# OpMode · Asistente de Cliente para Haxball (v4.0.0)

Script 100 % **lado cliente** que se pega en la consola DevTools dentro de
[`https://www.haxball.com/play`](https://www.haxball.com/play). Dibuja un
completo **overlay táctico y estético** encima del canvas del juego —líneas,
radios, trayectorias, predicción con rebotes, HUD de velocidad, alertas de
peligro, aros de equipo, crosshair y decoración de campo neon con 6 temas— y
un **menú desplegable** para controlarlo todo al vuelo.

> ## ¿Por qué v4 ya no lagea?
>
> La versión anterior bajaba los FPS en cuanto pegabas el script. Los 4
> culpables y su solución (detalladas en [Rendimiento](#rendimiento-y-optimización)):
>
> | Problema en v3 | Solución en v4 |
> |---|---|
> | `shadowBlur` por frame (brillos) | **Glow multicapa** con alpha progresivo (hasta ~50 % más barato). |
> | Overlay a DPR completo (pantallas HiDPI) | Overlay limitado a **DPR 1.75**. |
> | Muestreo fijo (2 frames / 320 px / todos los keys) | **Motor adaptativo**: mide cada análisis y auto-regula cadencia (1–6) y resolución (320→160 px). |
> | Reasignación de buffers y lecturas inútiles | Buffers **reutilizados**, contexto 2D **cacheado**, análisis **pausado** con overlay oculto, en pestañas ocultas o con fuente "custom". |
>
> Además se **corrigió el mapeo campo → mundo** (`toWorld`), que en v3
> desplazaba las líneas cuando el campo tiene letterbox o el detector suaviza
> su rectángulo. Ahora **las líneas encajan exactamente sobre el campo**.

---

## ⚠️ Aviso legal y de uso honesto

Es una **ayuda visual** (pinta encima del lienzo; **no modifica físicas,
memoria ni red**). En **torneos, ligas o clasificatorias** los overlays suelen
estar **prohibidos y sancionarse**: úsalo solo para **entrenar**, **salas
privadas** o **modo libre**. La detección por píxeles es aproximada y puede
perder el balón un instante; está diseñada para dar contexto visual, no para
"trucar" un partido en vivo contra otros.

---

## ✨ Qué hace (v4)

### Ayudas tácticas (ventaja en el juego)

| Ayuda | Tecla | Descripción |
|---|---|---|
| 🎯 **Línea balón → arco** | `N` | Línea neón del balón al arco **más lejano** (el que atacas), con aro brillante en la boca. |
| 🧭 **Línea yo → balón** | `J` | Línea amarilla discontinua de tu jugador al balón. |
| ⭕ **Radio de alcance** | `B` | Aro de contacto alrededor del balón y de tu jugador (verde = en distancia de tiro). |
| 📈 **Trayectoria corta** | `V` | Flecha con la dirección instantánea del balón (velocidad derivada). |
| 🔮 **Predicción + rebotes** | `P` | Simula hasta 3 rebotes en las paredes con fricción; marca con **✕ GOAL** si la trayectoria entra en la boca, o punto rojo si pega en el poste. |
| 💨 **Estela del balón** | `T` | Cola de ~22 posiciones con desvanecido para intuir el ritmo. |
| 📊 **HUD velocidad / gol** | `U` | Velocidad del balón, tiempo estimado al arco y distancia yo→balón. |
| 🚨 **Alerta de peligro** | `D` | Anillo rojo pulsante y `!` sobre ti cuando un rival está a < 55 u. |
| ❌ **Crosshair propio** | `C` | Miras de puntería centradas en tu jugador. |
| 🔆 **Aros de equipo** | `H` | Aros neón alrededor de cada jugador (rojo/azul) para lectura rápida del campo. |

### "Yo" (tu jugador) siempre marcado

Tu avatar lleva **triángulo blanco + aro pulsante** de su color. Puedes fijarlo
manual (`🎯 Soy yo` en el menú y clic sobre tu avatar) o automático (el
jugador más estable cerca del balón).

### Estética y diseño (colores de campo y avatares)

| Ayuda | Tecla | Descripción |
|---|---|---|
| 🏟️ **Decoración de campo** | `G` | Se **redibujan encima** línea de medio campo, círculo central, áreas, esquinas y **bocas de gol** con estilo neon. |
| 🎨 **6 temas de color** | menú | `neon`, `ice`, `inferno`, `royal`, `toxic`, `gold` — recolorean el decorado, los arcos y el HUD. |
| 🖍️ **Color y grosor** | menú | 6 colores rápidos de línea principal + slider de grosor 1–10. |
| ✨ **Brillo neon** | menú | Interruptor del glow multicapa (apágalo para máxima nitidez/FPS). |
| 🧪 **Demo animada** | menú | Si no hay campo (lobby, cargando), dibuja un partido simulado para ver todas las líneas al instante. |

---

## 🛠️ Instalación

1. Entra en [`https://www.haxball.com/play`](https://www.haxball.com/play).
   Puedes pegar **en la consola de la página principal** o **dentro del
   iframe del juego**: el script se auto-adapta y sube al documento superior.
2. `F12` → pestaña **Console**. (Chrome: si avisa *"Don't paste code you do
   not understand"*, pulsa **Allow pasting** una vez.)
3. Abre [`opmode-hax.js`](./opmode-hax.js), cópialo **completo** y pégalo +
   Enter.
4. Verás el botón **🎯 OP · M** arriba a la derecha. En una sala verás las
   líneas y el campo decorado; si estás en el lobby, pulsa **M** y activa
   **Demo** para ver el overlay funcionando.

> La configuración se guarda en `localStorage`: si recargas, vuelve a pegar y
> tus ajustes se restauran.

---

## ⌨️ Controles

| Tecla | Acción | | Tecla | Acción |
|---|---|---|---|---|
| **M** | Abrir / cerrar menú | | **T** | Estela del balón |
| **N** | Línea balón → arco | | **U** | HUD velocidad / gol |
| **J** | Línea yo → balón | | **D** | Alerta de peligro |
| **B** | Radio de alcance | | **G** | Decoración de campo |
| **V** | Trayectoria corta | | **C** | Crosshair propio |
| **P** | Predicción + rebotes | | **H** | Aros de equipo |
| **K** | Mostrar / ocultar TODO el overlay | | | |

### Fijar "yo"
- Menú → **🎯 Soy yo** → clic sobre tu avatar.
- O `OpMode.setMe(400, 200)` / `OpMode.setMe({x: 400, y: 200})`.
- `OpMode.resetMe()` o menú → **♻ Auto yo** vuelve al modo automático.

---

## 🔌 API de consola

```js
OpMode.state                      // { source, ball, me, players[], ballSpeed, field, perf, vis }
OpMode.toggle('predict')          // 'lineBallGoal'|'lineMeBall'|'radius'|'trajectory'|'predict'
                                  // |'trail'|'hud'|'danger'|'fieldDeco'|'crosshair'|'glowPlayers'
                                  // |'demo'|'overlay'
OpMode.setMe(x, y)                // fija "yo"; resetMe() lo vuelve a automático
OpMode.setBall(x, y)              // override puntual del balón
OpMode.setPlayers([{x, y, team}]) // override de jugadores (team 1=rojo, 2=azul)
OpMode.pickMe()                   // modo clic sobre tu avatar
OpMode.setTheme('ice')            // neon | ice | inferno | royal | toxic | gold
OpMode.nextTheme()                // cicla temas
OpMode.setDataSource(fn)          // fuente externa {me, ball, players[]} · null → píxeles
OpMode.destroy()                  // apaga overlay, menú y bucles
```

### Fuente de datos por API (opcional)

La detección por píxeles funciona en el cliente oficial sin modificar. Si
tienes tu propia fuente (bot/room externo vía `WebSocket`, etc.) puedes
enchufarla y OpMode **deja de leer el canvas** (aún menos carga):

```js
OpMode.setDataSource(() => ({
  me:   { x: 400, y: 200, team: 1 },
  ball: { x: 300, y: 150 }
}));
```

---

## ⚙️ Rendimiento y optimización (cómo lo mantiene a 60 FPS)

1. **La regla de oro**: no se intercepta el `requestAnimationFrame` del juego
   ni se escribe sobre su canvas. El overlay es un canvas propio encima.
2. **Lectura mínima**: cada `tickEvery` frames se copia el canvas del juego a
   una **miniatura ~320 px** con `drawImage` (acelerado por GPU) y se lee
   `getImageData` de esa miniatura (~200 KB, no 8 MB). Sin `readPixels` grandes.
3. **Motor adaptativo (`Perf`)**: cada análisis se cronometra con
   `performance.now()`. Objetivo < ~6 ms:
   - si tarda más **> 7.5 ms** → sube la cadencia (`tickEvery` 1→6) y baja la
     resolución (320→160 px);
   - si tarda menos **< 2.5 ms** → vuelve a subir calidad.
   El estado actual se ve en el menú y en el HUD: `A2·320px`.
4. **Brillos sin `shadowBlur`**: el glow se dibuja con 2–3 trazos finos
   adicionales con alpha creciente. Visualmente parecidos, mucho más baratos.
5. **Overlay a DPR limitado (1.75)**: en pantallas HiDPI se pintan menos
   píxeles sin pérdida perceptible.
6. **Cero lecturas inútiles**: no se analiza si el overlay está oculto (`K`),
   si la fuente es `custom`, si no hay canvas (Demo) o si la pestaña está
   oculta.
7. **Sin asignaciones por frame**: el buffer de componentes conexas se
   reutiliza, el contexto 2D se cachea y el menú refresca su estado cada
   ~300 ms (no por frame).
8. **Detección de máquina débil**: si hay ≤ 2 GB de RAM, ≤ 2 núcleos o un
   móvil, arranca ya en modo conservador (256 px, cada 3 frames).

> En juegos puestos «en pequeñito» o con el canvas en otra pestaña, puedes
> ayudarle con `OpMode.toggle` apagando ayudas que no uses y dejando
> `tickEvery`/`sampleWTarget` a sus valores por defecto.

---

## 🔍 Cómo funciona la detección por píxeles

1. Se localiza el `<canvas>` 2D del juego (el más grande con contenido vivo;
   si el canvas se queda en blanco, prueba el siguiente candidato).
2. Cada N frames se baja a miniatura y se analiza:
   - **Campo**: mancha verde → rectángulo del estadio (con EMA para que no
     vibre). Sirve además para corregir el **letterbox**.
   - **Balón**: mancha blanca compacta y redonda, con **continuidad temporal**
     (se premia la posición prevista por la velocidad del cuadro anterior).
   - **Jugadores**: manchas rojas/azules del tamaño esperado (el radio se
     escala al mundo real).
3. Se mapea a coordenadas de mundo (800×400) — mapeo **corregido** en v4 — y
   se dibuja sobre el overlay. La velocidad se suaviza con EMA para una
   trayectoria estable.

Ajustes iniciales del script (para expertos):
- `sampleWTarget` (ancho del análisis; 320, o 256 en máquinas débiles).
- `tickEvery` (análisis cada N frames; 2, o 3 en máquinas débiles).
- `adapt` (motor adaptativo; `true`).
- `holdMs` (cuánto conservar la última detección; 500 ms).
- `prediction` (tiempo, rebotes, fricción y rebote de la simulación).

---

## 🐛 Solución de problemas

| Problema | Solución |
|---|---|
| No veo el botón 🎯 OP | Pega en `haxball.com/play` (documento o iframe). Pulsa **K** por si el overlay estaba oculto. En el lobby activa **Demo** desde el menú. |
| Las líneas no encajan sobre el campo | Asegúrate de que el verde del estadio se detecta (menú: `campo ✓`). Si el estadio es muy oscuro/claro, el campo se marca ✗: elige el canvas correcto recargando o usa Demo. El mapeo v4 corrige el letterbox automáticamente. |
| Bajaron los FPS tras pegar | Esto **no** debería pasar en v4. Comprueba el `A·px` del menú: si subió (p. ej. `A5·160px`) el motor ya está reduciendo carga. Desactiva **Brillo neon** y ayudas que no uses. |
| Demo SÍ se ve pero en la sala no | El estadio usa colores fuera de los umbrales (verde, blanco, rojo/azul). Dímelo y ajusto `detectField`/`detectBall`, o usa `OpMode.setDataSource`. |
| El balón parpadea | Sube `sampleWTarget` tú mismo (edita el inicio del script) o baja el umbral de `Predicción`; la continuidad temporal ayuda pero no es infalible. |
| No detecta mi jugador (yo ✗) | Usa **🎯 Soy yo** (clic sobre tu avatar). El automático precisa que el avatar tenga borde rojo o azul. |
| El HUD/décor no aplica tema | Escoge el tema en el menú (o `OpMode.setTheme('gold')`); el color de línea principal se controla aparte con los círculos de color. |
| Recargué la página | Vuelve a pegar el script (los ajustes se conservan en `localStorage`). |
| Borrarlo todo | `OpMode.destroy()` o `F5`. Si re-pegas y avisa de instancia activa, primero haz `OpMode.destroy()`. |

---

## 🧪 Verificación

- Sintaxis: `node --check opmode-hax.js` ✓
- Test funcional de arranque/API con DOM simulado (Node) ✓
- Test de visión con campo+balón+jugadores sintéticos (detección y mapeo
  campo→mundo dentro de tolerancia ±4 u) ✓

---

## 📦 Contenido

```
opmode-hax/
├── opmode-hax.js    → el script (pégalo en la consola)
└── README.md        → esta guía
```

## 📜 Changelog

- **v4.0.0** — Rendimiento: sin `shadowBlur`, DPR 1.75, motor adaptativo,
  buffers reutilizados, muestreo condicional. Bugs: mapeo `toWorld` corregido.
  Nuevas ayudas: predicción con rebotes + GOAL/poste, estela, HUD, peligro,
  crosshair, aros de equipo. Estética: decoración de campo + 6 temas.
- **v3.0.0** — Detección por `drawImage`→`getImageData` a baja resolución;
  eliminado el falso camino WebGL; encontrar del campo verde, balón y jugadores.
- **v2.x** — (histórico) hook de rAF + `readPixels`; descartado por pérdida de
  FPS y no dibujar nada en cliente actual.

---

Uso libre para fines educativos y de entrenamiento, bajo tu responsabilidad.
No afiliado con Haxball ni con su equipo de desarrollo.