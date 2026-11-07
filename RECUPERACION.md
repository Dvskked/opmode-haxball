# CHICAGOBULLS APP — recuperación estable

Este paquete restaura la copia original proporcionada por el usuario, que contiene el diseño Chicago Bulls de Fase 1 y las funciones de juego/administración de Fase 2.

Se descartaron las modificaciones experimentales posteriores que podían afectar el inicio o la interfaz. El launcher ahora comprueba que estén presentes el manifest, CSS, JavaScript y logo, y solicita siempre una ventana Chromium en modo aplicación (`--app`).

## Inicio correcto
1. Extraer todo el ZIP.
2. Abrir la carpeta `apphaxball` (la que contiene `package.json` y `manifest.json`).
3. Abrir CMD en esa carpeta.
4. Ejecutar `npm install` (solo la primera vez).
5. Ejecutar `npm start`.

Esto abre una ventana de Edge/Chrome en modo aplicación y carga la extensión local. Todavía no es Electron ni un `.exe` independiente.
