// Build:  node scripts/build.mjs
//   dist/                              static site (copy to any web host / GitHub Pages)
//   dist/L7N-Fantasy-Lab-v<ver>-standalone.html   ONE self-contained file; works by double-click (file://) with no server
// No dependencies. The standalone bundler understands the subset of ES-module syntax this code base uses (named imports/exports).
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(dist, { recursive: true, force: true }); await mkdir(dist, { recursive: true });
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) await cp(join(root, f), join(dist, f));
for (const d of ['src', 'styles', 'assets']) await cp(join(root, d), join(dist, d), { recursive: true });

// ---------- standalone bundle ----------
const mods = new Map();   // id -> { code, deps }
async function load(file) {
  const id = relative(join(root, 'src'), file).split('\\').join('/').replace(/\.js$/, '');
  if (mods.has(id)) return id;
  mods.set(id, null);
  let src = await readFile(file, 'utf8');
  const exportsList = [];
  // imports
  src = src.replace(/^import\s+([\s\S]*?)\s+from\s+['"](\.[^'"]+)['"];?[ \t]*$/gm, (m, what, spec) => {
    const dep = resolve(dirname(file), spec); loadQueue.push(dep);
    const depId = relative(join(root, 'src'), dep).split('\\').join('/').replace(/\.js$/, '');
    what = what.trim();
    if (what.startsWith('* as ')) return `const ${what.slice(5).trim()} = __req(${JSON.stringify(depId)});`;
    const inner = what.replace(/^\{|\}$/g, '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/\s+as\s+/, ': ')).join(', ');
    return `const { ${inner} } = __req(${JSON.stringify(depId)});`;
  });
  // exports
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z0-9_$]+)/gm, (m, kind, name) => { exportsList.push(name); return `${kind} ${name}`; });
  src = src.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (m, names) => { names.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => exportsList.push(x.split(/\s+as\s+/).pop())); return ''; });
  if (/^\s*(import|export)\s/m.test(src.replace(/`[\s\S]*?`/g, ''))) throw new Error(`Unsupported import/export syntax in ${file}`);
  mods.set(id, `__def(${JSON.stringify(id)}, function () {\n${src}\nreturn { ${[...new Set(exportsList)].join(', ')} };\n});`);
  return id;
}
const loadQueue = [join(root, 'src/main.js')];
while (loadQueue.length) { const f = loadQueue.shift(); await load(f); }

const logo = (await readFile(join(root, 'assets/l7n-logo.png'))).toString('base64');
const logoUri = `data:image/png;base64,${logo}`;
let bundle = `(function () {\n'use strict';\nconst __defs = {}; const __cache = {};\nfunction __def(id, fn) { __defs[id] = fn; }\nfunction __req(id) { if (!__cache[id]) { if (!__defs[id]) throw new Error('missing module ' + id); __cache[id] = {}; __cache[id] = __defs[id](); } return __cache[id]; }\n${[...mods.values()].join('\n')}\n__req('main');\n})();`;
bundle = bundle.split('assets/l7n-logo.png').join(logoUri).replace(/<\/script/gi, '<\\/script');
const css = (await readFile(join(root, 'styles/app.css'), 'utf8'));
let html = await readFile(join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles/app.css">', () => `<style>\n${css}\n</style>`)
  .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
  .replace('<link rel="icon" href="assets/l7n-logo.png" type="image/png">', `<link rel="icon" href="${logoUri}" type="image/png">`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${bundle}\n</script>`);
const standalone = `L7N-Fantasy-Lab-v${version}-standalone.html`;
await writeFile(join(dist, standalone), html);

// plain-file listing for the record
const count = async (d) => (await readdir(d, { recursive: true })).length;
console.log(`built v${version}: dist/ (${await count(dist)} entries) + ${standalone} (${(html.length / 1024).toFixed(0)} KB, ${mods.size} modules)`);
void posix;
