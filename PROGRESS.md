# CHICAGO BULLS APP (CBA) — PROGRESS

## Versión 3.1.0

## Estado

- **Fase 1: completa** — rediseño de nickname y salas sobre el cliente oficial.
- **Fase 2: completa** — atribución, interfaz de sala/partida y menú administrativo que reutiliza diálogos y permisos originales.
- **Fase 3: completa** — sonidos adicionales opcionales generados localmente con Web Audio.
- **Fase 4: completa** — preferencias persistentes, reducción de movimiento y lista compacta.
- **Fase 5: completa (v3)** — centro de ajustes, perfiles, apariencia, balón/cancha aproximados, salas con búsqueda/favoritas/enlace y macro configurable.
- **Electron: no incluido** — el objetivo se mantiene en el cliente real de HaxBall.

## Implementado en v3

### Launcher

- `npm start` abre Edge/Chrome con perfil dedicado.
- Detección de perfiles con la extensión bloqueada (`disable_reasons`).
- Backup automático del perfil bloqueado y creación de uno limpio.
- Migración de `Default/Local Extension Settings` y verificación estricta de la skin.
- Flags de carga de extensión activos, incluido `--disable-features=DisableLoadExtensionCommandLineSwitch`.

### Centro de ajustes CBA

- Panel propio con pestañas: **PERFIL**, **APARIENCIA**, **BALÓN**, **CANCHA**, **SONIDOS**, **RENDIMIENTO**, **MACRO**.
- Persistencia en `chrome.storage.local` y sincronización en vivo entre popup y cliente.
- Perfil: nickname real, avatar local 96×96 WebP y borrado.
- Apariencia: fondo Bulls/oscuro/sin fondo/imagen propia, tres temas, animaciones, reducir movimiento, lista compacta y marca de agua.
- Balón: presets original/Bulls/neón/monocromático e intensidad.
- Cancha: presets y ajustes de brillo, saturación y contraste.
- Sonidos: ambiente, toque, chat, gol y tres volúmenes independientes.
- Rendimiento: modo rendimiento y baja latencia.
- Macro: tecla, acción, acción personalizada, intervalo y prueba.

### Salas

- Buscador en vivo sobre el listado real.
- Favoritas persistentes con estrella por fila y filtro ★.
- Entrada por URL de HaxBall o código corto, abriendo el cliente real.
- Sin salas inventadas ni datos falsos.

### Macro

- Por defecto: mantener **M** repite **X** cada 180 ms.
- Configurable en tecla, acción e intervalo.
- Se detiene al soltar, al perder foco y al ocultar la pestaña.
- Ignorado mientras se escribe en chat/campos de texto.
- Solo despacha eventos de teclado; no toca física, red ni paquetes.

### Popup

- Rebranding completo a **CHICAGO BULLS APP (CBA)**.
- Nickname real y accesos rápidos funcionales.
- Botón **ABRIR AJUSTES CBA** que abre el panel dentro de HaxBall.
- Volumen general y estado del cliente.

## Validación ejecutada

- `node --check` sobre JS principal, launcher, popup y pruebas.
- `npm test` con Edge real en modo headless:
  - branding del shell y del iframe;
  - nickname y cambio de nickname;
  - listado real (974 salas en la última ejecución);
  - buscador, favoritas, enlace inválido, panel CBA y macro;
  - ajustes originales de HaxBall, crear sala, administración, kick/ban y layout angosto;
  - sin errores JS de página ni fallos de recursos de la extensión.
- `npm start` con recuperación de perfil bloqueado y verificación estricta.

## Limitaciones conocidas

- HaxBall renderiza toda la escena en un único canvas: no se puede colorear solo el balón ni separar césped/líneas sin modificar el motor. Los ajustes de BALÓN/CANCHA son filtros globales aproximados.
- El aviso de gol se basa en anuncios del chat, no en el evento interno de colisión.
- El audio adicional requiere interacción del usuario para desbloquear Web Audio.
- Los selectores del cliente pueden cambiar si HaxBall actualiza su interfaz.
- No hay Electron ni instalador nativo.
- El uso de macros puede ser considerado ventaja por algunas salas; CBA no altera el juego.

## Pendientes

- Repetir la prueba E2E cuando HaxBall cambie su DOM.
- Verificar audio en el dispositivo del usuario final (el entorno automatizado no reproduce audio).
- Opcional: capturas nuevas de partida real si se ejecuta `CB_LIVE_JOIN=1`.


## 3.0.1 — ajustes visuales y HUD
- HUD Keystrokes en partida con teclas WASD, espacio, X, M y flechas; borde configurable desde Apariencia.
- Aviso de chat actualizado a doble tono tipo notificación de sala.
- Temas conectados a variables CSS y colores de acento por tema.
- Correcciones de overflow en tabla de salas.
- Iconos 16/32/48/128 regenerados a partir de `img/logochicago.png`.
- Limitación mantenida y documentada: el color individual del balón no es exponible por la API de HaxBall; el canvas único impide aislarlo sin alterar el motor.

## 3.1.0 — mecánicas de HaxBall Zero 2.0.4
- **JUGADOR:** `/avatar` real envía el avatar al jugador en cancha (máx. 2 caracteres/emoji), con aplicación automática al entrar y atajos de teclado configurables.
- **JUGADOR:** `/colors` real para camiseta (equipo rojo/azul, ángulo y hasta 3 colores) con presets, vista previa y restablecer.
- **HUD:** keystrokes compacto (138 px, 90 % por defecto) con posición en cuatro esquinas, escala y opacidad.
- **HUD:** marcador CBA que lee los hooks originales de puntaje/tiempo, oculta la barra nativa y muestra pop de gol, overtime y tiempo bajo.
- **HUD:** banner de gol, ocultar chat, ocultar ping/FPS, atajos de administración (K/B, Ctrl+Shift+E/X), salida sin confirmación, historial de chat y atajos de emoji.
- Crédito actualizado a **neptunzinho**.
- Corregida la detección de goles por expresiones regulares sobre-escapeadas.
