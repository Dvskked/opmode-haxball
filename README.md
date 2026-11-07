# CHICAGO BULLS APP (CBA)

Identidad visual **Chicago Bulls** para el cliente **real** de HaxBall, implementada como extensión de navegador (Manifest V3). No reemplaza HaxBall, no simula salas y no toca la lógica de conexión: aplica la piel sobre `haxball.com` y conserva todas las funciones originales.

**Versión 3.1.0** · Desarrollado por **neptunzinho** · Paleta `#CE1141`, negro, gris oscuro y blanco.

![Pantalla de nickname](docs/capturas/01-nickname.png)

| Salas públicas | Herramientas de salas | Ajustes CBA |
| --- | --- | --- |
| ![Salas](docs/capturas/02-salas.png) | ![Herramientas](docs/capturas/10-salas-tools.png) | ![Ajustes](docs/capturas/05-ajustes.png) |

---

## Estado

- **Actualización 3.1.0:** mecánicas reales de HaxBall Zero 2.0.4: `/avatar` para el jugador en cancha, `/colors` para camisetas, atajos rápidos de avatar, marcador CBA, banner de gol, historial/emojis de chat, atajos de administración, salida sin confirmación y keystrokes compacto configurable.


- Extensión real sobre el cliente oficial: salas, nickname, chat, partidas, marcador, replays, ajustes y red **sin cambios**.
- Launcher `npm start` con perfil dedicado, recuperación automática de perfiles bloqueados y verificación de carga de la skin.
- Centro de ajustes CBA con nueve secciones funcionales: **PERFIL**, **JUGADOR**, **APARIENCIA**, **HUD**, **BALÓN**, **CANCHA**, **SONIDOS**, **RENDIMIENTO** y **MACRO**.
- Listado de salas con buscador, favoritas persistentes y entrada por enlace/código.
- Macro de tecla mantenida configurable (por defecto **M** repite **X**).
- Sin Electron, sin backend propio, sin librerías de UI, sin datos falsos y sin automatizar el juego.

## Por qué una extensión

El cliente de HaxBall es cerrado y su UI real vive en un iframe del origen `haxball.com`. El endpoint de salas, el `api/client` y el reCAPTCHA están atados a ese origen; un cliente propio no puede unirse a salas reales sin romper la seguridad de HaxBall. Por eso CBA inyecta CSS y mejoras de presentación dentro del **origen permitido**, manteniendo el cliente oficial intacto.

El análisis técnico completo está en [docs/ANALISIS.md](docs/ANALISIS.md).

## Requisitos

- Microsoft Edge, Google Chrome o Chromium reciente.
- Windows, macOS o Linux.
- Node.js 18 o superior para el launcher y las pruebas.

## Instalación

### Opción A — launcher incluido (recomendada)

```bash
npm install
npm start
```

Abre una ventana dedicada con un perfil propio y la extensión cargada. En Windows usa Edge por defecto. Si no lo encuentra, indicá la ruta:

```powershell
$env:CB_BROWSER="C:\ruta\al\msedge.exe"; npm start
```

El launcher:

1. Usa un perfil aislado en `%LOCALAPPDATA%\CHICAGOBULLS-APP\profile`.
2. Detecta entradas de extensión bloqueadas por el navegador.
3. Si el perfil está bloqueado, lo respalda como `profile.backup-<fecha>` y crea uno limpio.
4. Migra los ajustes locales de la extensión y verifica que la skin cargó.

Variables útiles:

```powershell
$env:CB_PROFILE_DIR="C:\ruta\perfil"   # perfil alternativo
$env:CB_PROFILE_RESET="1"; npm start   # fuerza perfil nuevo (hace backup)
$env:CB_HEADLESS="1"; npm start        # verificación sin ventana
```

### Opción B — carga manual

1. Abrí `edge://extensions` o `chrome://extensions`.
2. Activá **Modo desarrollador**.
3. Elegí **Cargar descomprimida** y seleccioná esta carpeta.
4. Abrí <https://www.haxball.com/play>.

> Si el navegador ya estaba abierto con el mismo perfil, cerrá esa ventana y volvé a ejecutar el launcher. Los flags de carga de extensión solo se aplican al iniciar el proceso.

## Uso

1. Escribí tu nickname en la pantalla **CHICAGO BULLS APP (CBA)** y presioná **ENTRAR**.
2. Elegí una sala del listado real y presioná **UNIRSE** (o doble clic en la fila).
3. Si HaxBall pide **VERIFICACIÓN HUMANA**, resolvé el reCAPTCHA original.
4. Abrí **AJUSTES CBA** con el botón flotante para configurar la app.
5. Usá el cliente como siempre: crear sala, contraseñas, filtros, ajustes, replays, chat y sonidos.

El nickname también se guarda desde el popup. Se almacena en `chrome.storage.local` y se sincroniza con el `localStorage` original (`player_name`) del cliente.

## Centro de ajustes CBA

El botón **AJUSTES CBA** abre un panel sobre el cliente real. Cada control guarda su valor en `chrome.storage.local` y se aplica al instante.

| Sección | Controles |
| --- | --- |
| **PERFIL** | Nickname real de HaxBall, avatar local (96×96 WebP), borrar avatar. |
| **JUGADOR** | Avatar real en cancha con `/avatar`, emojis rápidos, atajos de teclado y camiseta con `/colors` (equipo, ángulo y hasta 3 colores). |
| **APARIENCIA** | Fondo Bulls, oscuro, sin fondo o imagen propia; tema Bulls/Medianoche/Carbón; animaciones; reducir movimiento; lista compacta; marca de agua. |
| **HUD** | Keystrokes compacto con posición, escala y opacidad; marcador CBA; ocultar chat/ping-FPS; atajos de administración; salida rápida; historial y emojis de chat. |
| **BALÓN** | Estilo original, rojo Bulls, neón o monocromático; intensidad 0–100 %. |
| **CANCHA** | Preset original, clásica, noche o alto contraste; brillo, saturación y contraste. |
| **SONIDOS** | Cuatro ambientes musicales sintetizados, feedback al patear, aviso de chat de dos tonos, aviso de gol; volúmenes independientes. |
| **RENDIMIENTO** | Modo rendimiento y prioridad de baja latencia (desactiva filtros del canvas). |
| **MACRO** | Activar/desactivar, tecla de activación, acción a repetir, acción personalizada, intervalo y prueba. |

### Macro de tecla mantenida

- Por defecto: mantené **M** para repetir **X** cada `180 ms`.
- Se detiene inmediatamente al soltar la tecla, al perder foco la ventana o al ocultarse la pestaña.
- Se desactiva mientras escribís en el chat o en cualquier campo de texto.
- La tecla, la acción y el intervalo son configurables.
- Solo simula pulsaciones de teclado normales: **no** modifica física, red ni paquetes de HaxBall.

### Buscador y favoritas

- **BUSCAR SALA** filtra el listado real por nombre sin ocultar datos ni inventar salas.
- La estrella ★ guarda una sala en favoritos; el filtro **FAVORITAS** muestra solo esas salas.
- **ENLACE O CÓDIGO DE SALA** acepta una URL de HaxBall (`?c=...`) o un código y abre la sala en el cliente real.

### Baja latencia

- **PRIORIZAR BAJA LATENCIA** desactiva los filtros visuales del canvas y las transiciones no esenciales.
- Para baja latencia real, usá también el ajuste original de HaxBall: **Ajustes → Video → Canvas de baja latencia**.
- CBA nunca toca el netcode, los WebSockets ni los paquetes del juego.

## Qué cambia visualmente

- Shell de `haxball.com/play`: header CBA, logo, tipografía condensada y fondo oscuro.
- Pantalla de nickname: logo original `img/logochicago.png`, panel oscuro, subtítulo y botón rojo.
- Listado de salas: panel compacto, filas de ~33 px, columnas claras, filtros tipo pill, selección roja, contador en español y herramientas CBA.
- Diálogos de crear sala, ajustes originales, cambio de nickname, conexión y verificación humana.
- UI dentro de la sala y de la partida: barra de estado, chat, estadísticas, listas de jugadores, marcador, paneles y botones.
- Menú contextual de administración sobre el nick: **Expulsar**, **Bloquear** e **Información** del jugador.
- Indicador `ADMIN` visible solo cuando la sala confirma permisos reales.
- Atribución discreta **“Desarrollado por neptunzinho”** en la interfaz, la partida y los ajustes.
- Animaciones sutiles y `prefers-reduced-motion` respetado.

Paleta usada: `#080808`, `#111111`, `#191919`, `#CE1141`, `#A30D32`, `#FFFFFF`. Los equipos rojo y azul conservan colores reconocibles.

## Administración de jugadores

- El menú solo se abre al hacer clic en el nombre de un jugador cuando el contenedor real `.room-view.admin` está presente.
- **Expulsar** reutiliza el diálogo original de HaxBall y envía la expulsión mediante su flujo oficial.
- **Bloquear** abre la expulsión original, activa “Ban from rejoining” y espera la confirmación; nunca expulsa en silencio.
- **Información** muestra únicamente datos reales del DOM: nombre, equipo, rol, ping y país.
- Para jugadores normales no se muestra el menú y se suprime el diálogo administrativo original deshabilitado.
- La autoridad sigue siendo la de HaxBall: si el cliente original deshabilita la acción, la extensión no la ejecuta.

## Qué se conserva

- Cliente, motor y conexión oficiales de HaxBall.
- Listado público real y sus datos (sin mocks).
- Selector y validación de nickname.
- Contraseñas, creación de salas, cambio de ubicación.
- reCAPTCHA y verificación humana.
- Filtros, actualización del listado, ajustes y controles.
- Replays, sonidos, chat, estadísticas y juego multijugador.
- WebSocket, WebRTC y almacenamiento original del cliente.

La extensión **no** intercepta tráfico, **no** lee credenciales, **no** automatiza el juego y **no** envía datos a servidores propios.

## Limitaciones conocidas

- **Balón y cancha:** HaxBall dibuja balón, jugadores, césped y líneas en un único canvas. No existe una capa separada del balón. Los ajustes de BALÓN/CANCHA aplican un filtro visual global calibrado como aproximación; por eso el preset de balón también afecta el resto de la escena y no es un cambio aislado del balón; crear un color de balón independiente requeriría modificar el renderizador interno del juego.
- **Sonidos:** los avisos son sintetizados localmente y complementarios. No se intercepta ni reemplaza el audio original. El feedback de X/espacio es de tecla, no detección exacta de colisión.
- **Aviso de gol:** se detecta por anuncios reconocibles en el chat; no hay acceso al evento interno exacto.
- **Web Audio:** requiere una interacción del usuario para desbloquear el audio del navegador.
- **Selectores:** si HaxBall cambia su DOM o sus textos, algunos estilos o traducciones pueden necesitar actualización.
- **Navegador:** requiere un Chromium reciente; no hay versión Electron.
- **Macro:** algunas salas pueden considerar el uso de macros como ventaja. CBA no altera el juego, pero el criterio de uso es del jugador.

## Estructura

```text
apphaxball/
├─ manifest.json            Extensión MV3 v3.1.0
├─ start.js                 Launcher, perfil dedicado y recuperación
├─ css/chicagobulls.css     Piel completa y centro de ajustes
├─ js/chicagobulls.js       Branding, ajustes, salas, sonidos y macro
├─ popup/                   Popup de la extensión
├─ img/
│  ├─ logochicago.png       Logo original
│  └─ fondo-bulls.svg       Fondo temático por defecto
├─ tests/extension.e2e.js   Prueba E2E con Edge/Chrome real
├─ docs/                    Análisis y capturas
├─ README.md
└─ PROGRESS.md
```

## Pruebas

```bash
npm install
npm test
```

La prueba E2E abre HaxBall real con la extensión, verifica branding, nickname, listado público, buscador, favoritas, enlace de sala, centro de ajustes, macro, administración por jugador y ausencia de errores JS/consola.

Verificación headless del launcher:

```powershell
$env:CB_HEADLESS="1"; $env:CB_CLOSE_AFTER_VERIFY="1"; $env:CB_VERIFY_STRICT="1"; node start.js
```

## Problemas frecuentes

- **La skin no aparece:** ejecutá `npm start` (no abras HaxBall en una ventana normal con el mismo perfil). Si el perfil quedó bloqueado, el launcher lo respalda y crea uno nuevo.
- **El navegador no abre:** definí `CB_BROWSER` con la ruta a `msedge.exe` o `chrome.exe`.
- **No suena nada:** activá el control correspondiente y hacé clic una vez en la página para desbloquear Web Audio.
- **El listado tarda:** el listado es el real de HaxBall y depende de su servidor. El botón **ACTUALIZAR** sigue funcionando.

## Créditos

- Cliente y juego: **HaxBall**.
- Skin y desarrollo CBA: **neptunzinho**.
- Logo e identidad: Chicago Bulls, usados como homenaje visual sin afiliación oficial.
