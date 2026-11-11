'use strict';

/**
 * Preload de CBA.
 *
 * Corre en el mundo aislado (contextIsolation activo) del documento principal
 * de haxball.com/play. La pagina de HaxBall NO obtiene acceso a Node: toda la
 * UI de CBA se construye desde aqui manipulando el DOM compartido.
 */

const { ipcRenderer } = require('electron');

// Solo el frame principal orquesta el cliente (el juego vive en un iframe
// same-origin al que accedemos por DOM, sin exponer nada a la pagina).
if (window.top === window) {
    try {
        require('./src/renderer/client.js')(ipcRenderer);
    } catch (eBoot) {
        try { console.error('[CBA] fallo al iniciar el cliente:', eBoot); } catch (e) {}
    }
}
