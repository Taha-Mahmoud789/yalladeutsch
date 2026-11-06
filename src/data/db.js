// klanger — local corpus storage (IndexedDB). One pack per video: meta + cues.

let _db = null;
const req = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

export function dbOpen() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const rq = indexedDB.open("klanger", 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore("packs", { keyPath: "id" }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { _db = null; rej(rq.error); };
  });
  return _db;
}

export async function dbPut(pack) {
  const d = await dbOpen();
  return req(d.transaction("packs", "readwrite").objectStore("packs").put(pack));
}

export async function dbPutAll(packs) {
  if (!packs.length) return;
  const db = await dbOpen();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("packs", "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Could not save backup clips"));
    try {
      const store = transaction.objectStore("packs");
      for (const pack of packs) store.put(pack);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export async function dbGet(id) {
  const d = await dbOpen();
  return req(d.transaction("packs").objectStore("packs").get(id));
}

export async function dbAll() {
  const d = await dbOpen();
  return req(d.transaction("packs").objectStore("packs").getAll());
}
