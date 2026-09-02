import {
  emptyNoteHistory,
  recordNoteAction,
  referencedNoteIds,
  redoNoteHistory,
  undoNoteHistory,
} from "./note-history.js";

const DATABASE_VERSION = 3;

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

function actionId() {
  return globalThis.crypto.randomUUID();
}

function restoreNote(note, now) {
  const { deletedAt, ...visibleNote } = note;
  return { ...visibleNote, updatedAt: now };
}

function deleteNoteAt(note, now) {
  return { ...note, deletedAt: now, updatedAt: now };
}

function historyAction(type, noteIds, now, values = {}) {
  return {
    id: actionId(),
    type,
    noteIds,
    ...values,
    createdAt: now,
  };
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
      if (!database.objectStoreNames.contains("history")) {
        database.createObjectStore("history", { keyPath: "sessionId" });
      }
      if (!database.objectStoreNames.contains("transcriptCache")) {
        database.createObjectStore("transcriptCache", { keyPath: "id" });
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
      transaction.onabort = () => reject(transaction.error ?? new Error("更新标记失败"));
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
    return notes
      .filter((note) => note.deletedAt === undefined)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async listPendingTranscriptions() {
    const database = await this.dbPromise;
    const notes = await requestResult(
      database.transaction("notes").objectStore("notes").getAll(),
    );
    return notes.filter((note) => (
      note.status === "saved" &&
      note.deletedAt === undefined &&
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

  putTranscriptCache(cache) {
    return this.write("transcriptCache", cache);
  }

  getTranscriptCache(sessionId) {
    return this.read("transcriptCache", sessionId);
  }

  async mutateHistory(sessionId, now, callback) {
    const database = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["notes", "history", "assets"], "readwrite");
      const noteStore = transaction.objectStore("notes");
      const historyStore = transaction.objectStore("history");
      const assetStore = transaction.objectStore("assets");
      const notesRequest = noteStore.getAll();
      const historyRequest = historyStore.get(sessionId);
      let allNotes;
      let storedHistory;
      let notesLoaded = false;
      let historyLoaded = false;
      let outcome;
      let settled = false;
      let abortError = null;

      const rememberAbortError = (error) => {
        if (abortError === null) abortError = error;
      };

      const run = () => {
        if (!notesLoaded || !historyLoaded) return;
        const notes = new Map(
          allNotes
            .filter((note) => note.sessionId === sessionId)
            .map((note) => [note.id, note]),
        );
        const history = storedHistory ?? emptyNoteHistory(sessionId);
        try {
          outcome = callback({ notes, history }) ?? {};
          const nextHistory = outcome.history
            ?? (outcome.action ? recordNoteAction(history, outcome.action) : history);
          for (const note of outcome.changedNotes ?? []) {
            noteStore.put(note);
          }
          if (outcome.action || outcome.history) {
            historyStore.put(nextHistory);
          }
          if (outcome.changed) {
            const referencedIds = referencedNoteIds(nextHistory);
            const allNotesById = new Map(allNotes.map((note) => [note.id, note]));
            for (const note of outcome.changedNotes ?? []) {
              allNotesById.set(note.id, note);
            }
            const deletedNotes = [...notes.values()].filter((note) => (
              note.deletedAt !== undefined && !referencedIds.has(note.id)
            ));
            const deletedNoteIds = new Set(deletedNotes.map((note) => note.id));
            const retainedAssetKeys = new Set(
              [...allNotesById.values()]
                .filter((note) => !deletedNoteIds.has(note.id))
                .flatMap((note) => [note.screenshotKey, note.audioKey])
                .filter(Boolean),
            );
            for (const note of deletedNotes) {
              noteStore.delete(note.id);
              if (note.screenshotKey && !retainedAssetKeys.has(note.screenshotKey)) {
                assetStore.delete(note.screenshotKey);
              }
              if (note.audioKey && !retainedAssetKeys.has(note.audioKey)) {
                assetStore.delete(note.audioKey);
              }
            }
          }
        } catch (error) {
          rememberAbortError(error);
          transaction.abort();
        }
      };

      notesRequest.onsuccess = () => {
        allNotes = notesRequest.result;
        notesLoaded = true;
        run();
      };
      historyRequest.onsuccess = () => {
        storedHistory = historyRequest.result;
        historyLoaded = true;
        run();
      };
      notesRequest.onerror = () => rememberAbortError(notesRequest.error);
      historyRequest.onerror = () => rememberAbortError(historyRequest.error);
      transaction.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(outcome?.result);
        }
      };
      transaction.onerror = () => rememberAbortError(transaction.error);
      transaction.onabort = () => {
        if (!settled) {
          settled = true;
          reject(abortError ?? transaction.error ?? new Error("笔记历史更新失败"));
        }
      };
    });
  }

  async commitSavedNote(id, changes, now = Date.now()) {
    const existing = await this.getNote(id);
    if (existing === undefined) throw new Error(`标记不存在：${id}`);
    return this.mutateHistory(existing.sessionId, now, ({ notes }) => {
      const note = notes.get(id);
      if (note === undefined) throw new Error(`标记不存在：${id}`);
      const updated = { ...note, ...changes, updatedAt: now };
      const becameSaved = note.status !== "saved" && updated.status === "saved";
      notes.set(id, updated);
      return {
        changed: true,
        changedNotes: [updated],
        action: becameSaved ? historyAction("add-note", [id], now) : undefined,
        result: updated,
      };
    });
  }

  mutateNoteValue(id, field, value, type, now, incrementsUserEditVersion) {
    return this.getNote(id).then((existing) => {
      if (existing === undefined) throw new Error(`标记不存在：${id}`);
      return this.mutateHistory(existing.sessionId, now, ({ notes }) => {
        const note = notes.get(id);
        if (note === undefined) throw new Error(`标记不存在：${id}`);
        if (note.status !== "saved" || note.deletedAt !== undefined) {
          throw new Error("笔记历史动作已过期");
        }
        if (note[field] === value) return { changed: false, result: note };
        const updated = {
          ...note,
          [field]: value,
          ...(incrementsUserEditVersion
            ? { userEditVersion: (note.userEditVersion ?? 0) + 1 }
            : {}),
          updatedAt: now,
        };
        notes.set(id, updated);
        return {
          changed: true,
          changedNotes: [updated],
          action: historyAction(type, [id], now, { before: note[field] ?? "", after: value }),
          result: updated,
        };
      });
    });
  }

  editNoteBody(id, value, now = Date.now()) {
    return this.mutateNoteValue(
      id,
      "body",
      String(value ?? "").trim(),
      "edit-body",
      now,
      true,
    );
  }

  editNoteSubtitle(id, value, now = Date.now()) {
    return this.mutateNoteValue(
      id,
      "subtitleContext",
      String(value ?? "").trim(),
      "edit-subtitle",
      now,
      false,
    );
  }

  deleteSavedNote(id, now = Date.now()) {
    return this.getNote(id).then((existing) => {
      if (existing === undefined) throw new Error(`标记不存在：${id}`);
      return this.mutateHistory(existing.sessionId, now, ({ notes }) => {
        const note = notes.get(id);
        if (note === undefined || note.deletedAt !== undefined) {
          throw new Error("笔记历史动作已过期");
        }
        const updated = deleteNoteAt(note, now);
        notes.set(id, updated);
        return {
          changed: true,
          changedNotes: [updated],
          action: historyAction("delete-note", [id], now),
          result: updated,
        };
      });
    });
  }

  clearSessionNotes(sessionId, now = Date.now()) {
    return this.mutateHistory(sessionId, now, ({ notes }) => {
      const visibleNotes = [...notes.values()].filter((note) => note.deletedAt === undefined);
      if (visibleNotes.length === 0) return { changed: false, result: [] };
      const changedNotes = visibleNotes.map((note) => {
        const updated = deleteNoteAt(note, now);
        notes.set(note.id, updated);
        return updated;
      });
      return {
        changed: true,
        changedNotes,
        action: historyAction("clear-session", visibleNotes.map((note) => note.id), now),
        result: changedNotes,
      };
    });
  }

  applyHistoryAction(notes, action, undo, now) {
    const actionNotes = action.noteIds.map((id) => notes.get(id));
    if (actionNotes.some((note) => note === undefined)) {
      throw new Error("笔记历史动作已过期");
    }
    const isEdit = action.type === "edit-body" || action.type === "edit-subtitle";
    const shouldDelete = (action.type === "add-note") === undo;
    if (isEdit) {
      const field = action.type === "edit-body" ? "body" : "subtitleContext";
      const expected = undo ? action.after : action.before;
      if (actionNotes.some((note) => note.deletedAt !== undefined || note[field] !== expected)) {
        throw new Error("笔记历史动作已过期");
      }
      return actionNotes.map((note) => {
        const updated = {
          ...note,
          [field]: undo ? action.before : action.after,
          ...(action.type === "edit-body"
            ? { userEditVersion: (note.userEditVersion ?? 0) + 1 }
            : {}),
          updatedAt: now,
        };
        notes.set(updated.id, updated);
        return updated;
      });
    }
    if (actionNotes.some((note) => (note.deletedAt !== undefined) !== !shouldDelete)) {
      throw new Error("笔记历史动作已过期");
    }
    return actionNotes.map((note) => {
      const updated = shouldDelete ? deleteNoteAt(note, now) : restoreNote(note, now);
      notes.set(updated.id, updated);
      return updated;
    });
  }

  changeHistoryStack(sessionId, now, changeHistory) {
    return this.mutateHistory(sessionId, now, ({ notes, history }) => {
      const { action, history: nextHistory } = changeHistory(history);
      if (action === null) return { changed: false, result: null };
      const changedNotes = this.applyHistoryAction(notes, action, changeHistory === undoNoteHistory, now);
      return {
        changed: true,
        changedNotes,
        history: { ...nextHistory, updatedAt: now },
        result: action,
      };
    });
  }

  undoNoteAction(sessionId, now = Date.now()) {
    return this.changeHistoryStack(sessionId, now, undoNoteHistory);
  }

  redoNoteAction(sessionId, now = Date.now()) {
    return this.changeHistoryStack(sessionId, now, redoNoteHistory);
  }

  async getNoteHistoryState(sessionId) {
    const history = await this.read("history", sessionId);
    return {
      canUndo: Boolean(history?.undo.length),
      canRedo: Boolean(history?.redo.length),
    };
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
