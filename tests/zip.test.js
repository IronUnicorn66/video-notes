import assert from "node:assert/strict";
import test from "node:test";

import { createZip } from "../src/core/zip.js";

test("生成包含 UTF-8 文件名与内容的无压缩 ZIP", () => {
  const bytes = createZip([
    { name: "笔记.md", data: "你好" },
    { name: "images/001.webp", data: new Uint8Array([1, 2, 3]) },
  ]);

  assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true), 0x04034b50);
  assert.ok(new TextDecoder().decode(bytes).includes("笔记.md"));
  assert.ok(new TextDecoder().decode(bytes).includes("你好"));
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 22).getUint32(0, true), 0x06054b50);
});
