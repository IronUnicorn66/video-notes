export function createWhisperOperationLock() {
  let activeOperation = null;

  return {
    async run(task) {
      if (activeOperation) throw new Error("模型操作进行中");
      const operation = Promise.resolve().then(task);
      activeOperation = operation;
      try {
        return await operation;
      } finally {
        if (activeOperation === operation) activeOperation = null;
      }
    },
  };
}
