import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactName = 'video-notes-edge-1.0.10.zip';
const artifactPath = path.join(repoRoot, 'artifacts', artifactName);

function readStoredZipEntries(archive) {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = archive.lastIndexOf(endSignature);
  assert.notEqual(endOffset, -1, '缺少 ZIP 结束目录');

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(centralOffset), 0x02014b50, '中央目录损坏');
    const method = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString('utf8');

    assert.equal(method, 0, `${name} 应使用无压缩存储`);
    assert.equal(compressedSize, uncompressedSize, `${name} 的存储大小不一致`);
    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, `${name} 的本地文件头损坏`);

    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, archive.subarray(dataOffset, dataOffset + compressedSize));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

test('发布包包含 Edge 运行文件和本地化资源', async () => {
  await execute(process.execPath, ['scripts/package-extension.mjs'], { cwd: repoRoot });
  const entries = readStoredZipEntries(await readFile(artifactPath));
  const files = [...entries.keys()];
  assert.deepEqual(files, [...files].sort(), '发布包文件顺序应保持稳定');

  for (const required of [
    '_locales/en/messages.json',
    '_locales/zh_CN/messages.json',
    'background.js',
    'content.js',
    'manifest.json',
    'sidepanel.html',
    'sidepanel.js',
  ]) {
    assert.ok(files.includes(required), `缺少 ${required}`);
  }
  assert.ok(files.every((name) => !name.endsWith('.map')));
  assert.ok(files.every((name) => !name.startsWith('store-assets/')));
  assert.ok(files.every((name) => !name.startsWith('node_modules/')));

  const packagedManifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  assert.equal(packagedManifest.version, '1.0.10');
  assert.ok(!('key' in packagedManifest), 'Edge 商店包不得包含开发环境 key');
});

test('发布包生成可核验的 SHA-256 文件', async () => {
  const checksum = await readFile(`${artifactPath}.sha256`, 'utf8');
  assert.match(checksum, /^[a-f0-9]{64}  video-notes-edge-1\.0\.10\.zip\n$/);
  const expected = checksum.slice(0, 64);
  const actual = createHash('sha256').update(await readFile(artifactPath)).digest('hex');
  assert.equal(actual, expected);
});
