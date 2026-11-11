# CHICAGO BULLS APP (CBA)

Cliente de escritorio **HaxBall** con identidad **Chicago Bulls**. Carga el
cliente oficial de HaxBall (https://www.haxball.com/play) dentro de Electron y
le añade, sin tocar su lógica, la capa CBA: barra Bulls, salas con buscador y
favoritos, panel de jugadores, marcador, historial de chat, key strokes,
macro configurable, música ambiental y ajustes de rendimiento.

## Requisitos

- Node.js 18+ (probado con Node 24)
- Windows 10/11 (x64) para el ejecutable; `npm start` funciona en cualquier SO

## Uso en desarrollo

```bash
npm install      # instala Electron y genera assets/icon.ico
npm start        # abre la aplicacion
npm test         # comprobaciones de sintaxis y recursos
```

## Generar el ejecutable de Windows

```bash
npm run dist            # instalador NSIS + version portable (x64)
npm run dist:portable   # solo portable
npm run dist:nsis       # solo instalador
```

La salida queda en `dist/`. La distribucion NO incluye la carpeta de
referencia `2.0.4/` (fuera de este proyecto).

## Funcionalidad

- **HaxBall real**: el juego original se ejecuta intacto en el iframe oficial.
- **Identidad Bulls**: negro + rojo Bulls (#ce1141), reestilizado completo vía CSS.
- **Salas**: buscador en vivo, favoritos persistentes, contadores y salas llenas.
- **Jugadores**: equipos, pings, administradores y datos de la sala.
- **Marcador CBA**: chip estilo Bulls con puntuación y cronómetro.
- **Key strokes**: panel inferior izquierdo, ocultable y arrastrable.
- **Macro**: sección propia en Ajustes (tecla M por defecto, 50–1000 ms,
  modos pulsos/mantener, límite de seguridad de 10 min, no funciona al escribir).
- **Música**: pads ambientales originales generados por WebAudio (sin derechos).
- **Multi-sala**: botón para abrir ventanas adicionales del cliente.
- **Rendimiento**: sin bucles de renderizado, observers puntuales, animaciones
  ligeras por defecto, prefers-FPS opcional.

## Créditos

- Desarrollador principal: **NEPTUNZINHO**
- Equipo de desarrollo: **NOREIK**
- Juego: HaxBall (haxball.com), cargado sin modificaciones de lógica.
