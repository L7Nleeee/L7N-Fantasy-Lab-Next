// Atomic, versioned publishing. Order of operations guarantees that `manifest.json` only ever points to a COMPLETE, verified version:
//   1. write every file into  .tmp-<version>/        2. read back + verify sha256
//   3. rename to  v/<version>/                       4. write manifest.json.tmp then rename over manifest.json   (the only "switch")
// A crash or failure at any earlier step leaves the previous manifest + files untouched.
import { mkdir, writeFile, readFile, rename, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './util.mjs';

const readJson = async (p) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };
export const readManifest = (outDir) => readJson(join(outDir, 'manifest.json'));
export const readStatus = (outDir) => readJson(join(outDir, 'status.json'));

async function atomicWrite(path, text) { const tmp = `${path}.tmp`; await writeFile(tmp, text); await rename(tmp, path); }

export async function writeStatus(outDir, patch) {
  await mkdir(outDir, { recursive: true });
  const old = (await readStatus(outDir)) ?? {};
  await atomicWrite(join(outDir, 'status.json'), JSON.stringify({ ...old, ...patch }, null, 2) + '\n');
}

/** @param {{outDir:string, version:string, files:Record<string,string>, manifest:object, keep?:number, hooks?:{beforeManifest?:Function}}} o */
export async function publish({ outDir, version, files, manifest, keep = 6, hooks = {} }) {
  await mkdir(join(outDir, 'v'), { recursive: true });
  for (const d of await readdir(outDir)) if (d.startsWith('.tmp-')) await rm(join(outDir, d), { recursive: true, force: true }); // debris of a crashed run
  const tmp = join(outDir, `.tmp-${version}`); await mkdir(tmp, { recursive: true });
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(join(tmp, name), text);
    await writeFile(join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const [name, meta] of Object.entries(manifest.files)) {
      const back = await readFile(join(tmp, name), 'utf8');
      if (sha256(back) !== meta.sha256) throw new Error(`read-back checksum mismatch for ${name}`);
    }
    await rename(tmp, join(outDir, 'v', version));
  } catch (e) { await rm(tmp, { recursive: true, force: true }); throw e; }
  await hooks.beforeManifest?.();                                   // test hook: simulate a crash right before the switch
  await atomicWrite(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // prune old versions (never the one the manifest points to)
  const versions = (await readdir(join(outDir, 'v'))).sort().reverse();
  for (const v of versions.slice(keep)) if (v !== version) await rm(join(outDir, 'v', v), { recursive: true, force: true });
  return { path: `v/${version}` };
}
