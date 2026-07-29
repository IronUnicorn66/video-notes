import assert from "node:assert/strict";
import test from "node:test";

import {
  acquirePlaybackLease,
  markPlayerPointerIntervention,
  markPlaybackIntervention,
  releasePlaybackLease,
} from "../src/core/playback-lease.js";

test("只恢复由插件暂停且用户未干预的视频", () => {
  const lease = acquirePlaybackLease({ paused: false }, { now: 100, ttlMs: 90_000 });
  assert.equal(lease.shouldPause, true);
  assert.equal(releasePlaybackLease(lease, { paused: true }, 200).shouldPlay, true);
});

test("进入前已经暂停时不恢复", () => {
  const lease = acquirePlaybackLease({ paused: true }, { now: 100 });
  assert.equal(lease.shouldPause, false);
  assert.equal(releasePlaybackLease(lease, { paused: true }, 200).shouldPlay, false);
});

test("协作插件先暂停后仍可接管原播放状态", () => {
  const lease = acquirePlaybackLease(
    { paused: true },
    { now: 100, wasPlaying: true },
  );
  assert.equal(lease.shouldPause, false);
  assert.equal(lease.pluginPaused, true);
  assert.equal(releasePlaybackLease(lease, { paused: true }, 200).shouldPlay, true);
});

test("用户后续操作会取消自动恢复资格", () => {
  const lease = acquirePlaybackLease({ paused: false }, { now: 100 });
  const intervened = markPlaybackIntervention(lease, "play", 150);
  assert.equal(releasePlaybackLease(intervened, { paused: true }, 200).shouldPlay, false);
});

test("播放器按下会把续播交给网站播放器", () => {
  const target = {};
  const player = { contains: (candidate) => candidate === target };
  const lease = acquirePlaybackLease({ paused: false }, { now: 100 });
  const intervened = markPlayerPointerIntervention(lease, player, target, 150);
  assert.deepEqual(releasePlaybackLease(intervened, { paused: true }, 200), {
    shouldPlay: false,
    reason: "user-intervened",
  });
});

test("播放器外按下不影响扩展自动续播", () => {
  const player = { contains: () => false };
  const lease = acquirePlaybackLease({ paused: false }, { now: 100 });
  const unchanged = markPlayerPointerIntervention(lease, player, {}, 150);
  assert.equal(releasePlaybackLease(unchanged, { paused: true }, 200).shouldPlay, true);
});

test("过期租约不恢复", () => {
  const lease = acquirePlaybackLease({ paused: false }, { now: 100, ttlMs: 50 });
  assert.equal(releasePlaybackLease(lease, { paused: true }, 151).shouldPlay, false);
});
