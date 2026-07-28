import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactName = 'video-notes-edge-0.3.0.zip';
const artifactPath = path.join(repoRoot, 'artifacts', artifactName);

test('发布包包含 Edge 运行文件和本地化资源', async () => {
  await execute(process.execPath, ['scripts/package-extension.mjs'], { cwd: repoRoot });
  const { stdout } = await execute('unzip', ['-Z1', artifactPath]);
  const files = stdout.trim().split('\n').sort();

  for (const required of [
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

  const { stdout: manifestText } = await execute('unzip', ['-p', artifactPath, 'manifest.json']);
  const packagedManifest = JSON.parse(manifestText);
  assert.equal(packagedManifest.version, '0.3.0');
  assert.ok(!('key' in packagedManifest), 'Edge 商店包不得包含开发环境 key');
});

test('发布包生成可核验的 SHA-256 文件', async () => {
  const checksum = await readFile(`${artifactPath}.sha256`, 'utf8');
  assert.match(checksum, /^[a-f0-9]{64}  video-notes-edge-0\.3\.0\.zip\n$/);
});
