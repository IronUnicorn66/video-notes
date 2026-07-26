import assert from "node:assert/strict";
import test from "node:test";

const controllerModule = await import("../src/core/note-sort-controller.js").catch(() => ({}));

test("用户切换顺序后立即更新显示并保存选择", async () => {
  const changes = [];
  const saves = [];
  const controller = controllerModule.createNoteSortController({
    initialOrder: "newest",
    onOrderChange: (order) => changes.push(order),
    persistOrder: async (order) => saves.push(order),
  });

  await controller.select("oldest");

  assert.equal(controller.order, "oldest");
  assert.deepEqual(changes, ["oldest"]);
  assert.deepEqual(saves, ["oldest"]);
});

test("保存失败时保留本次选择并报告错误", async () => {
  const errors = [];
  const controller = controllerModule.createNoteSortController({
    initialOrder: "newest",
    onOrderChange: () => {},
    persistOrder: async () => {
      throw new Error("存储不可用");
    },
    onPersistError: (error) => errors.push(error.message),
  });

  await controller.select("oldest");

  assert.equal(controller.order, "oldest");
  assert.deepEqual(errors, ["存储不可用"]);
});

test("恢复或同步外部偏好时更新显示且不重复保存", () => {
  const changes = [];
  let saveCount = 0;
  const controller = controllerModule.createNoteSortController({
    initialOrder: "newest",
    onOrderChange: (order) => changes.push(order),
    persistOrder: async () => {
      saveCount += 1;
    },
  });

  controller.sync("oldest");

  assert.equal(controller.order, "oldest");
  assert.deepEqual(changes, ["oldest"]);
  assert.equal(saveCount, 0);
});
