// Pure Node.js PNG generator — no external deps
// Uses raw PNG encoding (DEFLATE via zlib)

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function writeUint32BE(buf, val, offset) {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

function crc32(buf) {
  let crc = 0xffffffff;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })());
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  writeUint32BE(lenBuf, data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crcData = Buffer.concat([typeBuf, data]);
  writeUint32BE(crcBuf, crc32(crcData), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size, drawFn) {
  // RGBA pixel array
  const pixels = new Uint8Array(size * size * 4).fill(0);

  function setPixel(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
  }

  function fillRect(x1, y1, w, h, r, g, b, a = 255) {
    for (let y = y1; y < y1 + h; y++) {
      for (let x = x1; x < x1 + w; x++) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  function fillRoundRect(x1, y1, w, h, rad, r, g, b, a = 255) {
    for (let y = y1; y < y1 + h; y++) {
      for (let x = x1; x < x1 + w; x++) {
        const dx = Math.min(x - x1, x1 + w - 1 - x);
        const dy = Math.min(y - y1, y1 + h - 1 - y);
        if (dx < rad && dy < rad) {
          const dist = Math.sqrt((rad - dx - 0.5) ** 2 + (rad - dy - 0.5) ** 2);
          if (dist > rad) continue;
        }
        setPixel(x, y, r, g, b, a);
      }
    }
  }

  drawFn({ size, fillRect, fillRoundRect });

  // Build PNG raw data
  // IHDR
  const ihdr = Buffer.alloc(13);
  writeUint32BE(ihdr, size, 0);
  writeUint32BE(ihdr, size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB (we'll handle alpha manually as RGBA = type 6)
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw image data with filter bytes
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    rawRows.push(0); // filter byte: None
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      rawRows.push(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]);
    }
  }
  const raw = Buffer.from(rawRows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon({ size, fillRect, fillRoundRect }) {
  const bg = [15, 15, 17]; // #0f0f11
  const colors = [
    [99, 102, 241],  // #6366f1
    [139, 92, 246],  // #8b5cf6
    [167, 139, 250], // #a78bfa
    [196, 181, 253], // #c4b5fd
  ];

  const bgRad = Math.max(2, Math.round(size * 0.18));
  fillRoundRect(0, 0, size, size, bgRad, ...bg);

  const pad = Math.round(size * 0.12);
  const gap = Math.round(size * 0.06);
  const tileSize = Math.round((size - pad * 2 - gap) / 2);
  const rad = Math.max(1, Math.round(size * 0.07));

  const positions = [
    [pad, pad],
    [pad + tileSize + gap, pad],
    [pad, pad + tileSize + gap],
    [pad + tileSize + gap, pad + tileSize + gap],
  ];

  positions.forEach(([x, y], i) => {
    fillRoundRect(x, y, tileSize, tileSize, rad, ...colors[i]);
  });
}

const sizes = [16, 48, 128];
for (const s of sizes) {
  const png = makePNG(s, drawIcon);
  const out = path.join(__dirname, `icon${s}.png`);
  fs.writeFileSync(out, png);
  console.log(`Written: ${out} (${png.length} bytes)`);
}

console.log('PNG icons generated.');
