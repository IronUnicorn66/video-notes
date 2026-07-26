import assert from "node:assert/strict";
import test from "node:test";

const sorting = await import("../src/core/note-sort-order.js").catch(() => ({}));

test("缺失或未知偏好默认使用倒序", () => {
  assert.equal(typeof sorting.normalizeNoteSortOrder, "function");
  assert.equal(sorting.normalizeNoteSortOrder(undefined), "newest");
  assert.equal(sorting.normalizeNoteSortOrder("unknown"), "newest");
  assert.equal(sorting.normalizeNoteSortOrder("oldest"), "oldest");
});

test("正序和倒序返回对应副本且不修改输入数组", () => {
  assert.equal(typeof sorting.sortNotesForDisplay, "function");
  const notes = [
    { id: "middle", createdAt: 200 },
    { id: "oldest", createdAt: 100 },
    { id: "newest", createdAt: 300 },
  ];

  assert.deepEqual(
    sorting.sortNotesForDisplay(notes, "oldest").map(({ id }) => id),
    ["oldest", "middle", "newest"],
  );
  assert.deepEqual(
    sorting.sortNotesForDisplay(notes, "newest").map(({ id }) => id),
    ["newest", "middle", "oldest"],
  );
  assert.deepEqual(notes.map(({ id }) => id), ["middle", "oldest", "newest"]);
});
