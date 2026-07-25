const BUNDLED_MODEL_ID = "base-q5_1";

export function modelChunkKey(model, offset) {
  return `${model.url}?video-notes-model=${model.id}&chunk=${offset}`;
}

function binaryResponse(bytes) {
  return new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } });
}

export function createModelDownloader({
  openCache,
  fetchResource,
  digest,
  readBundled,
  onProgress = async () => {},
  clearProgress = async () => {},
  chunkSize = 4 * 1024 * 1024,
}) {
  async function clearModel(cache, model) {
    await cache.delete(model.url);
    for (let offset = 0; offset < model.size; offset += chunkSize) {
      await cache.delete(modelChunkKey(model, offset));
    }
  }

  async function verify(model, bytes) {
    if (bytes.byteLength !== model.size) {
      throw new Error(`模型大小校验失败：${bytes.byteLength}`);
    }
    if (await digest(bytes.buffer) !== model.sha256) {
      throw new Error("模型 SHA-256 校验失败");
    }
  }

  async function cached(model) {
    const cache = await openCache(model.cacheName);
    if (await cache.match(model.url)) return true;
    return model.id === BUNDLED_MODEL_ID && Boolean(await readBundled(model));
  }

  return {
    cached,

    async cachedIds(models) {
      const ids = [];
      for (const model of models) {
        if (await cached(model)) ids.push(model.id);
      }
      return ids;
    },

    async download(model) {
      const cache = await openCache(model.cacheName);
      if (await cache.match(model.url)) {
        await clearProgress();
        return { model: model.id, cached: true };
      }

      if (model.id === BUNDLED_MODEL_ID) {
        const bundled = await readBundled(model);
        if (bundled) {
          const bytes = new Uint8Array(await bundled.arrayBuffer());
          try {
            await verify(model, bytes);
          } catch (error) {
            await clearModel(cache, model);
            throw new Error(`内置模型${error.message}`);
          }
          await cache.put(model.url, binaryResponse(bytes));
          await clearProgress();
          return { model: model.id, cached: true, bundled: true };
        }
      }

      const chunks = [];
      let downloadedBytes = 0;
      try {
        for (let offset = 0; offset < model.size; offset += chunkSize) {
          const end = Math.min(offset + chunkSize, model.size) - 1;
          const key = modelChunkKey(model, offset);
          let response = await cache.match(key);
          if (!response) {
            response = await fetchResource(model.url, {
              cache: "no-store",
              headers: { Range: `bytes=${offset}-${end}` },
            });
            if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）`);
            const received = new Uint8Array(await response.arrayBuffer());
            if (response.status === 200 && received.byteLength === model.size) {
              chunks.push(received);
              downloadedBytes = received.byteLength;
              await onProgress({ modelId: model.id, downloadedBytes, totalBytes: model.size });
              break;
            }
            const expectedLength = end - offset + 1;
            if (response.status !== 206 || received.byteLength !== expectedLength) {
              throw new Error(`模型分块长度异常：期望 ${expectedLength}，收到 ${received.byteLength}`);
            }
            response = binaryResponse(received);
            await cache.put(key, response.clone());
          }
          const bytes = new Uint8Array(await response.arrayBuffer());
          chunks.push(bytes);
          downloadedBytes += bytes.byteLength;
          await onProgress({ modelId: model.id, downloadedBytes, totalBytes: model.size });
        }

        const modelBytes = new Uint8Array(downloadedBytes);
        let position = 0;
        for (const chunk of chunks) {
          modelBytes.set(chunk, position);
          position += chunk.byteLength;
        }
        await verify(model, modelBytes);
      } catch (error) {
        if (/校验失败|分块长度异常/.test(error.message)) await clearModel(cache, model);
        throw error;
      }

      const modelBytes = new Uint8Array(downloadedBytes);
      let position = 0;
      for (const chunk of chunks) {
        modelBytes.set(chunk, position);
        position += chunk.byteLength;
      }
      await cache.put(model.url, binaryResponse(modelBytes));
      for (let offset = 0; offset < model.size; offset += chunkSize) {
        await cache.delete(modelChunkKey(model, offset));
      }
      await clearProgress();
      return { model: model.id, cached: false };
    },
  };
}
