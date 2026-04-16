// Run with: node generate-icons.js
// Generates PNG icons using canvas (requires node-canvas) or falls back to writing SVG

const fs = require('fs');
const path = require('path');

function makeSVG(size) {
  const s = size;
  const pad = Math.round(s * 0.1);
  const half = Math.round(s / 2) - pad;
  const tileSize = Math.round(half * 0.9);
  const gap = Math.round(s * 0.05);
  const r = Math.max(2, Math.round(s * 0.07));

  const x1 = pad;
  const y1 = pad;
  const x2 = pad + tileSize + gap;
  const y2 = pad + tileSize + gap;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${Math.round(s * 0.18)}" fill="#0f0f11"/>
  <rect x="${x1}" y="${y1}" width="${tileSize}" height="${tileSize}" rx="${r}" fill="#6366f1"/>
  <rect x="${x2}" y="${y1}" width="${tileSize}" height="${tileSize}" rx="${r}" fill="#8b5cf6"/>
  <rect x="${x1}" y="${y2}" width="${tileSize}" height="${tileSize}" rx="${r}" fill="#a78bfa"/>
  <rect x="${x2}" y="${y2}" width="${tileSize}" height="${tileSize}" rx="${r}" fill="#c4b5fd"/>
</svg>`;
}

// Try to use canvas for real PNG generation
let canvas;
try {
  canvas = require('canvas');
} catch (_e) {
  canvas = null;
}

const sizes = [16, 48, 128];

for (const size of sizes) {
  const svg = makeSVG(size);
  const svgPath = path.join(__dirname, `icon${size}.svg`);
  const pngPath = path.join(__dirname, `icon${size}.png`);

  if (canvas) {
    const { createCanvas, loadImage } = canvas;
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = new canvas.Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      fs.writeFileSync(pngPath, c.toBuffer('image/png'));
      console.log(`Written: ${pngPath}`);
    };
    img.src = Buffer.from(svg);
  } else {
    // Fallback: write SVG as PNG (browsers accept SVG named .png in extensions for dev)
    fs.writeFileSync(pngPath, svg);
    console.log(`Written SVG→PNG fallback: ${pngPath}`);
  }

  fs.writeFileSync(svgPath, svg);
}

console.log('Icons generated.');
