// Coach private keys live in IndexedDB as NON-extractable CryptoKey objects:
// scripts on this page can use them to decrypt, but nothing can read the key bytes out.
const DB = 'cashflow-keys', STORE = 'keys';

function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode), s = t.objectStore(STORE);
    const req = fn(s);
    t.oncomplete = () => { d.close(); resolve(req && req.result); };
    t.onerror = t.onabort = () => { d.close(); reject(t.error); };
  }));
}

// id = `${userId}:${kid}`
export const keystore = {
  async list(userId) {
    const all = (await tx('readonly', s => s.getAll())) || [];
    return all.filter(k => k.userId === userId);
  },
  put(userId, { kid, publicRaw, privateKey }) {
    return tx('readwrite', s => s.put({ id: userId + ':' + kid, userId, kid, publicRaw, privateKey, savedAt: Date.now() }));
  },
  async clear(userId) {
    const mine = await this.list(userId);
    await tx('readwrite', s => { mine.forEach(k => s.delete(k.id)); });
  }
};
