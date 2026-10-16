// Thin, failure-tolerant wrapper around localStorage (or any compatible backend, e.g. an in-memory fake in tests).
// All L7N Lab keys live under one prefix, so the original V4.0.21 keys on the same origin are never touched.

export const NS = 'l7nlab.v1.';

export function createMemoryBackend(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _map: m,
  };
}

export function createStorage(backend, { quotaBytes = null } = {}) {
  let b = backend;
  if (!b) { try { b = globalThis.localStorage; } catch { b = null; } }
  if (!b) b = createMemoryBackend();
  const api = {
    backend: b, writes: 0, lastError: null,
    getJSON(key, fallback = null) {
      try { const s = b.getItem(NS + key); return s === null ? fallback : JSON.parse(s); } catch (e) { api.lastError = e; return fallback; }
    },
    getRaw(key) { try { return b.getItem(NS + key); } catch { return null; } },
    /** @returns {{ok:boolean,error?:string}} never throws */
    setJSON(key, value) {
      try {
        const s = JSON.stringify(value);
        if (quotaBytes && s.length > quotaBytes) throw new Error('quota exceeded (simulated)');
        b.setItem(NS + key, s); api.writes++; return { ok: true };
      } catch (e) { api.lastError = e; return { ok: false, error: String(e?.message || e) }; }
    },
    remove(key) { try { b.removeItem(NS + key); } catch (e) { api.lastError = e; } },
    /** Read-only access to keys outside our namespace (legacy V4.0.21). Never writes or deletes. */
    readForeign(key) { try { return b.getItem(key); } catch { return null; } },
    keys() { const ks = []; try { for (let i = 0; i < b.length; i++) { const k = b.key(i); if (k && k.startsWith(NS)) ks.push(k.slice(NS.length)); } } catch { /* ignore */ } return ks; },
  };
  return api;
}
