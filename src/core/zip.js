const encoder = new TextEncoder();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return encoder.encode(String(data));
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function view(size) {
  const bytes = new Uint8Array(size);
  return { bytes, data: new DataView(bytes.buffer) };
}

export function createZip(files) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const body = asBytes(file.data);
    const checksum = crc32(body);
    const local = view(30);
    local.data.setUint32(0, 0x04034b50, true);
    local.data.setUint16(4, 20, true);
    local.data.setUint16(6, 0x0800, true);
    local.data.setUint32(14, checksum, true);
    local.data.setUint32(18, body.length, true);
    local.data.setUint32(22, body.length, true);
    local.data.setUint16(26, name.length, true);
    locals.push(local.bytes, name, body);

    const central = view(46);
    central.data.setUint32(0, 0x02014b50, true);
    central.data.setUint16(4, 20, true);
    central.data.setUint16(6, 20, true);
    central.data.setUint16(8, 0x0800, true);
    central.data.setUint32(16, checksum, true);
    central.data.setUint32(20, body.length, true);
    central.data.setUint32(24, body.length, true);
    central.data.setUint16(28, name.length, true);
    central.data.setUint32(42, localOffset, true);
    centrals.push(central.bytes, name);

    localOffset += local.bytes.length + name.length + body.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = view(22);
  end.data.setUint32(0, 0x06054b50, true);
  end.data.setUint16(8, files.length, true);
  end.data.setUint16(10, files.length, true);
  end.data.setUint32(12, centralSize, true);
  end.data.setUint32(16, localOffset, true);

  return concat([...locals, ...centrals, end.bytes]);
}
