export function createTranscriberManager({ create }) {
  let transcriber = null;
  let loadedModelId = "";
  let loadingModelId = "";
  let loadingPromise = null;

  async function disposeLoaded() {
    if (!transcriber) return;
    const instance = transcriber;
    transcriber = null;
    loadedModelId = "";
    await instance.destroy?.();
  }

  return {
    get loadedModelId() {
      return loadedModelId;
    },

    async ensure(modelId) {
      if (transcriber && loadedModelId === modelId) return transcriber;
      if (loadingPromise) {
        if (loadingModelId === modelId) return loadingPromise;
        throw new Error("模型正在切换");
      }

      loadingModelId = modelId;
      loadingPromise = (async () => {
        await disposeLoaded();
        const instance = await create(modelId);
        transcriber = instance;
        loadedModelId = modelId;
        return instance;
      })();

      try {
        return await loadingPromise;
      } finally {
        loadingPromise = null;
        loadingModelId = "";
      }
    },

    async dispose() {
      if (loadingPromise) await loadingPromise;
      await disposeLoaded();
    },
  };
}
