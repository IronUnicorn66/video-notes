import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = path.join(repoRoot, 'store-assets', 'edge');
const svgFiles = (await readdir(assetRoot)).filter((name) => name.endsWith('.svg'));

await Promise.all(svgFiles.map(async (name) => {
  const source = path.join(assetRoot, name);
  const target = source.replace(/\.svg$/, '.png');
  await sharp(source).png({ compressionLevel: 9, palette: true }).toFile(target);
  process.stdout.write(`rendered ${path.basename(target)}\n`);
}));
