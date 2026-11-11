'use strict';

/**
 * Genera los iconos de Electron a partir del logo original del proyecto
 * (img/logochicago.png) SIN inventar ni sustituir el logo.
 *
 * - assets/icon.ico : contenedor ICO con la entrada PNG de 256x256
 *                     (formato PNG-compressed ICO, soportado desde Vista).
 * - assets/icon.png : copia del logo original para usos genericos.
 *
 * No requiere dependencias externas.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'img', 'logochicago.png');
const OUT_DIR = path.join(ROOT, 'assets');

function main() {
    if (!fs.existsSync(SRC)) {
        console.error('[icons] no se encontro img/logochicago.png');
        process.exit(1);
    }
    const png = fs.readFileSync(SRC);

    // Validacion minima del PNG (firma + IHDR 256x256).
    if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) {
        throw new Error('img/logochicago.png no es un PNG valido');
    }
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (width > 256 || height > 256) {
        throw new Error('el logo debe medir como maximo 256x256 para ICO (actual: ' + width + 'x' + height + ')');
    }

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    // ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes) + datos PNG.
    const ico = Buffer.alloc(6 + 16 + png.length);
    ico.writeUInt16LE(0, 0); // reserved
    ico.writeUInt16LE(1, 2); // type: icon
    ico.writeUInt16LE(1, 4); // count
    ico[6] = width >= 256 ? 0 : width; // 0 = 256
    ico[7] = height >= 256 ? 0 : height;
    ico[8] = 0; // palette
    ico[9] = 0; // reserved
    ico.writeUInt16LE(1, 10); // planes
    ico.writeUInt16LE(32, 12); // bit count
    ico.writeUInt32LE(png.length, 14); // bytes in resource
    ico.writeUInt32LE(22, 18); // offset of image data
    png.copy(ico, 22);

    fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
    fs.copyFileSync(SRC, path.join(OUT_DIR, 'icon.png'));

    console.log('[icons] icon.ico generado (' + ico.length + ' bytes, ' + width + 'x' + height + ')');
    console.log('[icons] icon.png copiado desde img/logochicago.png');
}

main();
