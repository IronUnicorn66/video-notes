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

test('Edge 商店 SVG 源文件可复现且不嵌入外部资源', async () => {
  for (const filename of [...expectedPngs.keys()].map((name) => name.replace('.png', '.svg'))) {
    const svg = await readFile(path.join(assetRoot, filename), 'utf8');
    assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.doesNotMatch(svg, /<(?:image|script)\b/i);
    assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:\/\//i);
  }
});
