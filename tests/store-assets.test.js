import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = path.join(repoRoot, 'store-assets', 'edge');

const expectedPngs = new Map([
  ['logo-300.png', [300, 300]],
  ['promo-440x280.png', [440, 280]],
  ['screenshot-1-note.png', [1280, 800]],
  ['screenshot-1-note-en.png', [1280, 800]],
  ['screenshot-2-context.png', [1280, 800]],
  ['screenshot-3-export.png', [1280, 800]],
]);

const expectedExtensionIcons = new Map([
  ['icon-16.png', [16, 16]],
  ['icon-32.png', [32, 32]],
  ['icon-48.png', [48, 48]],
  ['icon-128.png', [128, 128]],
]);

function readPngSize(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    '文件必须是 PNG',
  );
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test('Edge 商店 PNG 素材尺寸完整', async () => {
  for (const [filename, expectedSize] of expectedPngs) {
    const file = await readFile(path.join(assetRoot, filename));
    assert.deepEqual(readPngSize(file), expectedSize, filename);
  }
});

test('扩展图标尺寸完整且官网复用同一矢量源', async () => {
  for (const [filename, expectedSize] of expectedExtensionIcons) {
    const file = await readFile(path.join(repoRoot, 'assets', filename));
    assert.deepEqual(readPngSize(file), expectedSize, filename);
  }

  const extensionIcon = await readFile(path.join(repoRoot, 'assets', 'icon.svg'), 'utf8');
  const siteIcon = await readFile(path.join(repoRoot, 'docs', 'assets', 'icon.svg'), 'utf8');
  assert.equal(siteIcon, extensionIcon);
  assert.match(extensionIcon, /#dccdb8/);
  assert.match(extensionIcon, /#34363b/);
  assert.match(extensionIcon, /#a9824d/);
  assert.doesNotMatch(extensionIcon, /#0b284a|#38584b|#d66655/i);
});

test('Edge 商店 SVG 源文件可复现且不嵌入外部资源', async () => {
  for (const filename of [...expectedPngs.keys()].map((name) => name.replace('.png', '.svg'))) {
    const svg = await readFile(path.join(assetRoot, filename), 'utf8');
    assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<(?:image|script)\b/i);
    assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:\/\//i);
  }
});

test('商店品牌素材使用新版视频转图文笔记标识', async () => {
  for (const filename of ['logo-300.svg', 'promo-440x280.svg']) {
    const svg = await readFile(path.join(assetRoot, filename), 'utf8');
    assert.match(svg, /#dccdb8/);
    assert.match(svg, /#34363b/);
    assert.match(svg, /#a9824d/);
    assert.doesNotMatch(svg, /#0b284a|#38584b|#d66655/i);
  }
});
