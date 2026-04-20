// Brand color detection — 3-tier approach inspired by insane-design's brand_candidates.py
// Tier 1: Semantic CSS variable names (--*-brand-*, --*-primary-*, --*-accent-*)
// Tier 2: Selector-role analysis (hex values in CTA/button/nav selectors)
// Tier 3: Frequency analysis with logo-wall and SVG contamination filtering
// Plus: color coalescence (group near-identical hex values)

// ─── HEX UTILITIES ────────────────────────────────────────────────────────────

function normalizeHex(hex) {
  let value = hex.replace(/^#/, '');
  if (value.length === 3 || value.length === 4) {
    value = value.split('').map(ch => ch + ch).join('');
  }
  return `#${value.toUpperCase()}`;
}

function hexToRgb(hex) {
  const h = normalizeHex(hex).replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function hexSaturation(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  if (max === min) return 0;
  const l = (max + min) / 2;
  const d = 1 - Math.abs(2 * l - 1);
  return d === 0 ? 0 : ((max - min) / d) * 100;
}

function hexLightness(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255 * 100;
}

function colorDistance(hex1, hex2) {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  return Math.sqrt(
    Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2)
  );
}

// ─── COLOR COALESCENCE ────────────────────────────────────────────────────────
// Group near-identical hex values (within a perceptual distance threshold)

export function coalesceColors(hexList, threshold = 25) {
  const groups = [];

  for (const hex of hexList) {
    const normalized = normalizeHex(hex);
    let found = false;

    for (const group of groups) {
      if (colorDistance(group.representative, normalized) <= threshold) {
        group.members.push(normalized);
        group.count += 1;
        found = true;
        break;
      }
    }

    if (!found) {
      groups.push({ representative: normalized, members: [normalized], count: 1 });
    }
  }

  groups.sort((a, b) => b.count - a.count);
  return groups;
}

// ─── TIER 1: SEMANTIC VARIABLE NAME DETECTION ─────────────────────────────────

const BRAND_KEYWORDS = ['brand', 'primary', 'accent', 'action', 'cta'];
const ROLE_ORDER = ['cta', 'action', 'brand', 'primary', 'accent'];

function pickRole(name) {
  const lower = name.toLowerCase();
  let best = null;

  for (const keyword of ROLE_ORDER) {
    const index = lower.indexOf(keyword);
    if (index === -1) continue;
    const order = ROLE_ORDER.indexOf(keyword);
    if (!best || index < best.index || (index === best.index && order < best.order)) {
      best = { index, order, keyword };
    }
  }

  return best ? best.keyword : '';
}

export function extractSemanticBrandVars(cssVars, resolvedMap) {
  const results = [];
  const seen = new Set();

  for (const [name, data] of Object.entries(cssVars)) {
    const role = pickRole(name);
    if (!role) continue;

    const resolved = resolvedMap[name]
      ? resolvedMap[name].resolvedTerminal
      : (data.resolvedValue || data.value || '');

    const hexMatch = (typeof resolved === 'string') ? resolved.match(/#[0-9a-fA-F]{3,8}/) : null;
    if (!hexMatch) continue;

    const valueHex = normalizeHex(hexMatch[0]);
    const key = `${name}:${valueHex}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({ name, valueHex, role });
  }

  return results;
}

// ─── TIER 2: SELECTOR-ROLE HEX DETECTION ──────────────────────────────────────
// Runs inside the page context (extracted as a standalone function)

export function extractSelectorRoleHex(allCssText) {
  const results = [];
  const seen = new Set();

  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = ruleRegex.exec(allCssText)) !== null) {
    const selector = match[1].replace(/\s+/g, ' ').trim();
    if (!/button|btn|cta|primary|action|nav|link/i.test(selector)) continue;

    const body = match[2];
    const declRegex = /([\w-]+)\s*:\s*([^;{}]*#[0-9a-fA-F]{3,8}[^;{}]*)/g;
    let declMatch;

    while ((declMatch = declRegex.exec(body)) !== null) {
      const property = declMatch[1];
      const hexMatch = declMatch[2].match(/#[0-9a-fA-F]{3,8}/);
      if (!hexMatch) continue;

      const hexValue = normalizeHex(hexMatch[0]);
      const ruleSnippet = `${selector} { ${body.replace(/\s+/g, ' ').trim().slice(0, 200)} }`;
      const key = `${selector}:${property}:${hexValue}`;

      if (seen.has(key)) continue;
      seen.add(key);

      results.push({ selector, property, hex: hexValue, ruleSnippet });
    }
  }

  return results;
}

// ─── TIER 3: FREQUENCY ANALYSIS WITH CONTAMINATION FILTERING ──────────────────

function countHexes(text) {
  const counts = {};
  for (const match of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const hex = normalizeHex(match[0]);
    counts[hex] = (counts[hex] || 0) + 1;
  }
  return counts;
}

function extractSvgHexCounts(html) {
  const counts = {};
  for (const match of html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const svgHexes = countHexes(match[0]);
    for (const [hex, count] of Object.entries(svgHexes)) {
      counts[hex] = (counts[hex] || 0) + count;
    }
  }
  return counts;
}

function extractLogoWallHexCounts(html) {
  const counts = {};
  const logoPatterns = [
    /<(?:section|div|aside)[^>]*(?:class|id|data-[\w-]+)=(['"])[^'"]*(?:customer|logo-wall|trusted|featured|partners)[^'"]*\1[^>]*>[\s\S]*?<\/(?:section|div|aside)>/gi,
    /<ul[^>]*(?:class|id|data-[\w-]+)=(['"])[^'"]*logo-carousel[^'"]*\1[^>]*>[\s\S]*?<\/ul>/gi,
  ];

  for (const pattern of logoPatterns) {
    for (const match of html.matchAll(pattern)) {
      const blockHexes = countHexes(match[0]);
      for (const [hex, count] of Object.entries(blockHexes)) {
        counts[hex] = (counts[hex] || 0) + count;
      }
    }
  }

  return counts;
}

export function extractFrequencyCandidates(cssText, htmlText) {
  const totalCounts = countHexes(`${cssText}\n${htmlText}`);
  if (Object.keys(totalCounts).length === 0) return [];

  const svgCounts = extractSvgHexCounts(htmlText);
  const logoWallCounts = extractLogoWallHexCounts(htmlText);

  const sorted = Object.entries(totalCounts).sort((a, b) => b[1] - a[1]);
  const candidates = [];

  for (const [hexValue, count] of sorted.slice(0, 30)) {
    const logoWallCount = logoWallCounts[hexValue] || 0;
    let kind = 'frequency';

    if (logoWallCount && logoWallCount * 2 >= count) {
      kind = 'logo_wall';
    } else {
      const svgCount = svgCounts[hexValue] || 0;
      const externalCount = count - svgCount;

      if (svgCount && svgCount >= Math.max(1, externalCount * 2)) {
        kind = 'svg_pattern';
      } else if (hexSaturation(hexValue) < 10) {
        kind = 'neutral';
      } else {
        kind = 'chromatic';
      }
    }

    candidates.push({ hex: hexValue, count, kind });
  }

  return candidates;
}

// ─── BRAND COLOR SYNTHESIS ────────────────────────────────────────────────────
// Combines all three tiers to produce a definitive brand color list

export function detectBrandColors(cssVars, resolvedMap, allCssText, htmlText) {
  const semantic = extractSemanticBrandVars(cssVars, resolvedMap);
  const selectorRole = extractSelectorRoleHex(allCssText);
  const frequency = extractFrequencyCandidates(allCssText, htmlText);

  const chromatic = frequency.filter(c => c.kind === 'chromatic');
  const neutrals = frequency.filter(c => c.kind === 'neutral');
  const contaminated = frequency.filter(c => c.kind === 'logo_wall' || c.kind === 'svg_pattern');

  let brandColor = null;
  const brandCandidates = [];

  if (semantic.length > 0) {
    for (const s of semantic) {
      brandCandidates.push({ hex: s.valueHex, source: `semantic:${s.role}`, confidence: 'high' });
    }
    brandColor = semantic[0].valueHex;
  }

  if (selectorRole.length > 0 && !brandColor) {
    const bgColors = selectorRole.filter(s =>
      /background|bg|border/.test(s.property.toLowerCase()) && hexSaturation(s.hex) > 30
    );
    if (bgColors.length > 0) {
      brandColor = bgColors[0].hex;
      brandCandidates.push({ hex: bgColors[0].hex, source: 'selector:cta-bg', confidence: 'high' });
    }
  }

  if (chromatic.length > 0 && !brandColor) {
    brandColor = chromatic[0].hex;
    brandCandidates.push({ hex: chromatic[0].hex, source: 'frequency:chromatic', confidence: 'medium' });
  }

  const colorRamp = buildColorRamp(frequency.map(c => c.hex), semantic);

  return {
    brandColor,
    brandCandidates,
    chromatic,
    neutrals,
    contaminated,
    colorRamp,
  };
}

// ─── COLOR RAMP BUILDER ───────────────────────────────────────────────────────
// Groups hex values into families by hue proximity

function hueFromHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  if (max === min) return -1;
  const d = max - min;
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return h;
}

function buildColorRamp(allHexes, semanticVars) {
  const families = {};
  const HUE_BUCKET = 30;

  for (const hex of allHexes) {
    const hue = hueFromHex(hex);
    const sat = hexSaturation(hex);
    const light = hexLightness(hex);

    if (sat < 10) continue;

    const bucket = Math.round(hue / HUE_BUCKET) * HUE_BUCKET;
    if (!families[bucket]) families[bucket] = [];
    families[bucket].push({ hex, hue, sat, light });
  }

  const ramps = {};
  for (const [bucket, colors] of Object.entries(families)) {
    colors.sort((a, b) => a.light - b.light);
    ramps[bucket] = colors;
  }

  if (semanticVars.length > 0) {
    const brandHue = hueFromHex(semanticVars[0].valueHex);
    if (brandHue >= 0) {
      const brandBucket = Math.round(brandHue / HUE_BUCKET) * HUE_BUCKET;
      if (ramps[brandBucket]) ramps.brand = ramps[brandBucket];
    }
  }

  return ramps;
}

// ─── PITFALLS DETECTION ────────────────────────────────────────────────────────

export function detectPitfalls(cssVars, fonts, stylesheetData) {
  const warnings = [];

  const neutralHexes = Object.entries(cssVars)
    .filter(([name]) => /neutral|gray|grey|slate|zinc|stone|sand/i.test(name))
    .map(([, data]) => data.resolvedValue || data.value || '');

  const hasWarmNeutral = neutralHexes.some(v => {
    const m = v.match(/#[0-9a-fA-F]{6}/);
    if (!m) return false;
    const { r, g, b } = hexToRgb(m[0]);
    return r > b + 10 && g > b + 5;
  });
  if (hasWarmNeutral) {
    warnings.push({ type: 'warm_neutral', message: 'Site uses warm neutrals (not pure gray). Neutrals have a yellow/red tint — do not replace with #808080 or cool grays.' });
  }

  const multiLayerShadows = (stylesheetData.shadows || []).filter(s =>
    (s.match(/rgba/g) || []).length >= 2 || (s.match(/rgb/g) || []).length >= 2
  );
  if (multiLayerShadows.length > 0) {
    warnings.push({ type: 'multi_layer_shadow', message: `Found ${multiLayerShadows.length} multi-layer shadow(s). Do not flatten to single box-shadow — the depth relies on multiple layers.` });
  }

  const variableWeights = (fonts.loaded || []).filter(f => {
    const w = parseFloat(f.weight);
    return w !== 100 && w !== 200 && w !== 300 && w !== 400 && w !== 500 && w !== 600 && w !== 700 && w !== 800 && w !== 900;
  });
  if (variableWeights.length > 0) {
    const details = variableWeights.map(f => `${f.family} ${f.weight}`).join(', ');
    warnings.push({ type: 'variable_font_weight', message: `Non-standard font weights detected: ${details}. Cannot replicate with standard Inter/Roboto — use the exact font.` });
  }

  const tailwindV4Vars = Object.keys(cssVars).filter(k => k.startsWith('--tw-'));
  if (tailwindV4Vars.length > 0) {
    const hasThemeSpace = cssVars['--spacing'] || cssVars['--space'];
    if (hasThemeSpace) {
      warnings.push({ type: 'tailwind_v4', message: 'Detected Tailwind v4 @theme syntax. Spacing uses --spacing multiplier, not standard rem scale.' });
    }
  }

  const nextFontFallbacks = (fonts.declaredFamilies || []).filter(f =>
    /Fallback/i.test(f) && /Inter|Mona|Sohne/i.test(f)
  );
  if (nextFontFallbacks.length > 0) {
    warnings.push({ type: 'next_font_metric', message: `Detected next/font metric fallbacks: ${nextFontFallbacks.join(', ')}. These are layout-shift prevention fonts, not the real brand font.` });
  }

  const headingNegativeTracking = Object.entries(cssVars).filter(([name, data]) => {
    const v = (data.resolvedValue || data.value || '').trim();
    return /letter|tracking/i.test(name) && v.startsWith('-');
  });
  if (headingNegativeTracking.length > 0) {
    warnings.push({ type: 'negative_tracking', message: 'Headings use negative letter-spacing (optical compensation). Without it, large text looks "loose".' });
  }

  return warnings;
}
