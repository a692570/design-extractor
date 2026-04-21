// Standalone verification: feed the new detectBrandColors() the kind of
// roleColors the new runRoleColorsScript would return on coinbase.com, and
// confirm #0052FF (the real primary CTA) wins over #0A0B0D (body text black).
//
// Run: node test/brand-colors.test.mjs

import { detectBrandColors, anyColorToHex, extractSelectorRoleFromDom } from '../lib/brand-colors.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.log(`  ✗ ${msg}`);
    failures++;
  }
}

// ─── test: anyColorToHex ──────────────────────────────────────────────────────
console.log('\nanyColorToHex:');
assert(anyColorToHex('rgb(0, 82, 255)') === '#0052FF', 'rgb() → hex');
assert(anyColorToHex('rgba(0, 82, 255, 0.9)') === '#0052FF', 'rgba() with alpha → hex');
assert(anyColorToHex('rgba(0, 82, 255, 0)') === null, 'fully transparent → null');
assert(anyColorToHex('#0052FF') === '#0052FF', 'hex pass-through');
assert(anyColorToHex('#05f') === '#0055FF', 'short hex expands');
assert(anyColorToHex('transparent') === null, 'transparent → null');
assert(anyColorToHex('rgb(238, 240, 243)') === '#EEF0F3', 'grey rgb → hex');

// ─── test: extractSelectorRoleFromDom ─────────────────────────────────────────
console.log('\nextractSelectorRoleFromDom:');
const roleColors = [
  // The primary "Get started" CTA in Coinbase hero
  { role: 'cta', selector: 'button.width-w7d45bg', bg: 'rgb(0, 82, 255)', fg: 'rgb(255,255,255)', border: 'rgb(0, 82, 255)', area: 7888, hasPrimaryHint: false },
  // Same class appears multiple times (signup buttons across page)
  { role: 'cta', selector: 'button.width-wqtq8ao', bg: 'rgb(0, 82, 255)', fg: 'rgb(255,255,255)', border: 'rgb(0, 82, 255)', area: 6600, hasPrimaryHint: false },
  { role: 'cta', selector: 'button.width-w57eq5x', bg: 'rgb(0, 82, 255)', fg: 'rgb(255,255,255)', border: 'rgb(0, 82, 255)', area: 7700, hasPrimaryHint: false },
  // Sign-in ghost button (light grey bg)
  { role: 'button', selector: 'button.btn-ghost', bg: 'rgb(238, 240, 243)', fg: 'rgb(0, 82, 255)', border: 'rgb(238, 240, 243)', area: 3080, hasPrimaryHint: false },
  // Search icon (grey circle)
  { role: 'button', selector: 'button.cds-Button', bg: 'rgb(238, 240, 243)', fg: 'rgb(10, 11, 13)', border: 'rgb(238, 240, 243)', area: 1936, hasPrimaryHint: false },
  // Dark pill near footer (language chip)
  { role: 'button', selector: 'button._3-_in1y0k', bg: 'rgb(40, 43, 49)', fg: 'rgb(255,255,255)', border: 'rgb(0,0,0)', area: 4224, hasPrimaryHint: false },
];

const dom = extractSelectorRoleFromDom(roleColors);
console.log('  top-ranked:', dom.slice(0, 3).map(d => `${d.hex}(${d.role},uses=${d.uses})`).join(', '));
assert(dom.length > 0, 'produces at least one candidate');
assert(dom[0].hex === '#0052FF', `top candidate is #0052FF (got ${dom[0].hex})`);
assert(dom[0].role === 'cta', `top candidate role = cta (got ${dom[0].role})`);

// ─── test: full detectBrandColors with Coinbase-like inputs ───────────────────
console.log('\ndetectBrandColors (coinbase.com scenario):');
// Coinbase has NO color CSS vars; cssVars only hold font-family + viewport sizes
const cssVars = {
  '--cds-font-sans': { value: 'CoinbaseSans, sans-serif' },
  '--full-view-height': { value: '932px' },
  '--transitions': { value: 'none' },
};
const resolvedMap = {};
// allCssText would therefore just be var declarations — useless for Tier 2 legacy scan
const allCssText = '--cds-font-sans: CoinbaseSans, sans-serif;\n--full-view-height: 932px;';
// htmlSnapshot simulating the body text (lots of black #0A0B0D references) to trigger Tier 3
const htmlSnapshot = Array(40).fill('color:#0A0B0D').join(';') + ';background:#0052FF;';

const result = detectBrandColors(cssVars, resolvedMap, allCssText, htmlSnapshot, roleColors);
console.log('  brandColor:', result.brandColor);
console.log('  sources   :', result.brandCandidates.map(c => `${c.hex}(${c.source})`).join(', '));
assert(result.brandColor === '#0052FF', `brand color = #0052FF (got ${result.brandColor})`);
assert(
  result.brandCandidates.some(c => c.source.startsWith('dom:')),
  'brand candidates include a dom:* source'
);

// ─── test: graceful fallback when roleColors is empty ─────────────────────────
console.log('\ndetectBrandColors (no DOM data — fall through to frequency):');
const result2 = detectBrandColors(cssVars, resolvedMap, allCssText, htmlSnapshot, []);
console.log('  brandColor:', result2.brandColor);
assert(result2.brandColor !== null, 'still produces *some* brand color');
assert(!result2.brandCandidates.some(c => c.source.startsWith('dom:')), 'no dom:* sources when input empty');

// ─── summary ──────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log('✓ all passed');
  process.exit(0);
} else {
  console.log(`✗ ${failures} failed`);
  process.exit(1);
}
