const DATABASE_VERSION = 1;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB 事务已中止"));
  });
}

export class VideoNotesRepository {
  constructor({
    databaseName = "video-notes",
    indexedDB = globalThis.indexedDB,
    IDBKeyRange = globalThis.IDBKeyRange,
  } = {}) {
    if (!indexedDB) throw new Error("当前环境不支持 IndexedDB");
    this.databaseName = databaseName;
    this.indexedDB = indexedDB;
    this.IDBKeyRange = IDBKeyRange;
    this.db = null;
    this.dbPromise = this.open();
  }

  open() {
    const request = this.indexedDB.open(this.databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("sessions")) {
        database.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("notes")) {
        const notes = database.createObjectStore("notes", { keyPath: "id" });
        notes.createIndex("sessionId", "sessionId", { unique: false });
      }
      if (!database.objectStoreNames.contains("assets")) {
        database.createObjectStore("assets", { keyPath: "key" });
      }
    };
    return requestResult(request).then((database) => {
      this.db = database;
      return database;
    });
  }

  async read(storeName, key) {
    const database = await this.dbPromise;
    return requestResult(database.transaction(storeName).objectStore(storeName).get(key));
  }

  async write(storeName, value) {
    const database = await this.dbPromise;
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionDone(transaction);
    return value;
  }

  async remove(storeName, key) {
    const database = await this.dbPromise;
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  }

  putSession(session) {
    return this.write("sessions", session);
  }

  getSession(id) {
    return this.read("sessions", id);
  }

  putNote(note) {
    return this.write("notes", note);
  }

  getNote(id) {
    return this.read("notes", id);
  }

  async updateNote(id, updater) {
    const database = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("notes", "readwrite");
      const store = transaction.objectStore("notes");
      const request = store.get(id);
      let updated;
      request.onsuccess = () => {
        if (request.result === undefined) {
          transaction.abort();
          reject(new Error(`标记不存在：${id}`));
          return;
        }
        try {
          updated = updater(request.result);
          store.put(updated);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(updated);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => {
        if (updated !== undefined) reject(transaction.error ?? new Error("更新标记失败"));
      };
    });
  }

  deleteNote(id) {
    return this.remove("notes", id);
  }

  async listNotes(sessionId) {
    const database = await this.dbPromise;
    const transaction = database.transaction("notes");
    const index = transaction.objectStore("notes").index("sessionId");
    const notes = await requestResult(index.getAll(this.IDBKeyRange.only(sessionId)));
    return notes.sort((left, right) => left.createdAt - right.createdAt);
  }

  async listPendingTranscriptions() {
    const database = await this.dbPromise;
    const notes = await requestResult(
      database.transaction("notes").objectStore("notes").getAll(),
    );
    return notes.filter((note) => (
      note.status === "saved" &&
      Boolean(note.audioKey) &&
      ["pending", "transcribing"].includes(note.transcriptionStatus)
    ));
  }

  putAsset(key, blob) {
    return this.write("assets", {
      key,
      blob,
      mimeType: blob.type,
      createdAt: Date.now(),
    });
  }

  async getAsset(key) {
    return (await this.read("assets", key))?.blob;
  }

  deleteAsset(key) {
    return this.remove("assets", key);
  }

  close() {
    if (this.db) this.db.close();
    else void this.dbPromise.then((database) => database.close());
  }

  async destroy() {
    const database = await this.dbPromise;
    database.close();
    await requestResult(this.indexedDB.deleteDatabase(this.databaseName));
  }
}
