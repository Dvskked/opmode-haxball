'use strict';

/**
 * Comprobaciones rapidas del proyecto CBA (sin Electron):
 *  - sintaxis de todos los .js del proyecto
 *  - existencia de recursos (logo, iconos generados, package.json)
 *  - esquema de ajustes por defecto
 *
 * Uso: npm test
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;

function ok(msg) { console.log('  [OK]   ' + msg); }
function bad(msg) { failures++; console.log('  [FAIL] ' + msg); }

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

console.log('== Sintaxis de archivos JS ==');
const files = [path.join(ROOT, 'main.js'), path.join(ROOT, 'preload.js')]
    .concat(walk(path.join(ROOT, 'src'), []), walk(path.join(ROOT, 'tools'), []));
for (const file of files) {
    const rel = path.relative(ROOT, file);
    try {
        new Function(fs.readFileSync(file, 'utf8')); // solo parseo
        ok(rel);
    } catch (e) {
        bad(rel + ' -> ' + e.message);
    }
}

console.log('== Recursos ==');
const pkgPath = path.join(ROOT, 'package.json');
try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    ok('package.json (main: ' + pkg.main + ')');
    if (pkg.scripts && pkg.scripts.start) ok('script npm start');
    else bad('falta npm start');
} catch (e) {
    bad('package.json: ' + e.message);
}
fs.existsSync(path.join(ROOT, 'img', 'logochicago.png'))
    ? ok('img/logochicago.png')
    : bad('falta img/logochicago.png');
fs.existsSync(path.join(ROOT, 'assets', 'icon.ico'))
    ? ok('assets/icon.ico')
    : bad('falta assets/icon.ico (ejecuta: npm run icons)');
fs.existsSync(path.join(ROOT, 'src', 'renderer', 'client.js'))
    ? ok('src/renderer/client.js')
    : bad('falta src/renderer/client.js');
fs.existsSync(path.join(ROOT, 'preload.js')) ? ok('preload.js') : bad('falta preload.js');

console.log('== Ajustes por defecto ==');
try {
    const store = require(path.join(ROOT, 'src', 'main', 'store.js'));
    const d = store.DEFAULTS;
    const checks = [
        ['macro.key por defecto = KeyM', d.macro.key === 'KeyM'],
        ['macro.interval en rango 50-1000', d.macro.interval >= 50 && d.macro.interval <= 1000],
        ['musica no arranca sola', d.music.on === false],
        ['volumen por defecto bajo', d.music.volume <= 0.3],
        ['key strokes visibles por defecto', d.ui.keystrokesVisible === true]
    ];
    for (const [label, pass] of checks) (pass ? ok : bad)(label);
} catch (e) {
    bad('store: ' + e.message);
}

console.log(failures === 0 ? '\nTODO CORRECTO' : '\n' + failures + ' COMPROBACION(ES) FALLIDAS');
process.exit(failures === 0 ? 0 : 1);
