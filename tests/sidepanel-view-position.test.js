import assert from "node:assert/strict";
import test from "node:test";

import { createSidePanelViewPositionController } from "../src/core/sidepanel-view-position.js";

function createStorageArea(initial = {}) {
  let values = structuredClone(initial);
  return {
    async get(defaults) {
      return { ...structuredClone(defaults), ...structuredClone(values) };
    },
    async set(nextValues) {
      values = { ...values, ...structuredClone(nextValues) };
    },
  };
}

function createHarness(storage, {
  page = 0,
  transcript = 0,
  groupSize = 5,
} = {}) {
  const state = { page, transcript, groupSize };
  const controller = createSidePanelViewPositionController({
    storage,
    readPagePosition: () => state.page,
    restorePagePosition: (position) => { state.page = position; },
    readTranscriptPosition: () => state.transcript,
    restoreTranscriptPosition: (position) => { state.transcript = position; },
    getTranscriptGroupSize: () => state.groupSize,
  });
  return { controller, state };
}

test("侧栏文档销毁后按视频恢复页面和完整字幕位置", async () => {
  const storage = createStorageArea();
  const first = createHarness(storage, { groupSize: 5 });
  await first.controller.activate("youtube:course-a");
  await first.controller.restorePage();
  await first.controller.restoreTranscript();
  first.state.page = 684;
  first.state.transcript = 326;
  await first.controller.flush();

  const reopened = createHarness(storage, { groupSize: 5 });
  await reopened.controller.activate("youtube:course-a");
  await reopened.controller.restorePage();
  await reopened.controller.restoreTranscript();

  assert.equal(reopened.state.page, 684);
  assert.equal(reopened.state.transcript, 326);
});

test("完整字幕位置按视频和合并档位分别恢复", async () => {
  const storage = createStorageArea();
  const view = createHarness(storage, { page: 120, transcript: 510, groupSize: 5 });
  await view.controller.activate("youtube:course-a");
  view.controller.capture();

  view.state.groupSize = 10;
  view.state.transcript = 930;
  view.controller.capture();
  await view.controller.flush();

  view.state.page = 0;
  view.state.transcript = 0;
  view.state.groupSize = 5;
  await view.controller.restorePage();
  await view.controller.restoreTranscript();
  assert.equal(view.state.page, 120);
  assert.equal(view.state.transcript, 510);

  view.state.groupSize = 10;
  await view.controller.restoreTranscript();
  assert.equal(view.state.transcript, 930);

  await view.controller.activate("youtube:course-b");
  view.state.page = 0;
  view.state.transcript = 0;
  await view.controller.restorePage();
  await view.controller.restoreTranscript();
  assert.equal(view.state.page, 0);
  assert.equal(view.state.transcript, 0);
});

test("同一视频内容重载前保留两个滚动容器的位置", async () => {
  const storage = createStorageArea();
  const view = createHarness(storage, { page: 260, transcript: 740, groupSize: 20 });
  await view.controller.activate("youtube:course-a");
  await view.controller.restorePage();
  await view.controller.restoreTranscript();

  view.state.page = 260;
  view.state.transcript = 740;
  view.controller.prepareContentReload();
  view.state.page = 0;
  view.state.transcript = 0;
  await view.controller.restorePage();
  await view.controller.restoreTranscript();

  assert.equal(view.state.page, 260);
  assert.equal(view.state.transcript, 740);
});

test("内容清空后立即切换视频不会用零位置覆盖刚保存的记录", async () => {
  const storage = createStorageArea();
  const view = createHarness(storage, { groupSize: 5 });
  await view.controller.activate("youtube:course-a");
  await view.controller.restorePage();
  await view.controller.restoreTranscript();
  view.state.page = 440;
  view.state.transcript = 880;

  view.controller.prepareContentReload();
  view.state.page = 0;
  view.state.transcript = 0;
  await view.controller.activate("youtube:course-b");
  await view.controller.activate("youtube:course-a");
  await view.controller.restorePage();
  await view.controller.restoreTranscript();

  assert.equal(view.state.page, 440);
  assert.equal(view.state.transcript, 880);
});
