// Service worker (MV3) — orchestrates injection, receives data, generates all outputs
// Uses ES module imports (manifest declares "type": "module")

import { generateDesignMd } from './lib/generate-design-md.js';
import { generateStructureMd } from './lib/generate-structure-md.js';
import { generateStylesMd } from './lib/generate-styles-md.js';
import { resolveCssVarsMap } from './lib/var-resolver.js';
import { detectBrandColors, detectPitfalls } from './lib/brand-colors.js';
import { generateHtmlReport } from './lib/generate-html-report.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT') {
    handleExtraction(message.tabId, message.tabUrl);
    return false;
  }
});

async function sendProgress(pct, msg) {
  try {
    await chrome.runtime.sendMessage({ type: 'EXTRACTION_PROGRESS', pct, msg });
  } catch (_e) {}
}

async function handleExtraction(tabId, tabUrl) {
  try {
    await sendProgress(5, 'Injecting extraction script...');

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: runContentScript,
    });

    if (!results || !results[0]) {
      throw new Error('Script injection returned no results.');
    }

    const data = results[0].result;
    if (!data) {
      throw new Error('Content script returned null — page may be restricted (chrome://, about:, etc.).');
    }

    await sendProgress(25, 'Resolving var() chains...');

    const normalized = normalizeData(data);

    const resolvedMap = resolveCssVarsMap(normalized.cssVars);

    await sendProgress(40, 'Detecting brand colors...');

    const allCssText = buildAllCssText(normalized.cssVars);

    const brandColors = detectBrandColors(
      normalized.cssVars,
      resolvedMap.vars,
      allCssText,
      data.htmlSnapshot || ''
    );

    await sendProgress(50, 'Running pitfall detection...');

    const warnings = detectPitfalls(normalized.cssVars, normalized.fonts, normalized.stylesheetData);

    await sendProgress(55, 'Extracting assets...');

    let assets = {};
    try {
      const assetResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: runAssetScript,
      });
      if (assetResults && assetResults[0] && assetResults[0].result) {
        assets = assetResults[0].result;
      }
    } catch (e) {
      console.warn('[Design Extractor] Asset extraction failed (non-fatal):', e);
    }

    await sendProgress(65, 'Capturing component structure...');

    let structureComponents = {};
    try {
      const structureResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: runStructureScript,
      });
      if (structureResults && structureResults[0] && structureResults[0].result) {
        structureComponents = structureResults[0].result;
      }
    } catch (structErr) {
      console.warn('[Design Extractor] Structure extraction failed (non-fatal):', structErr);
    }

    await sendProgress(75, 'Extracting component CSS rules...');

    let cssRules = {};
    try {
      const stylesResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: runStylesScript,
        args: [structureComponents],
      });
      if (stylesResults && stylesResults[0] && stylesResults[0].result) {
        cssRules = stylesResults[0].result;
      }
    } catch (stylesErr) {
      console.warn('[Design Extractor] Styles extraction failed (non-fatal):', stylesErr);
    }

    await sendProgress(82, 'Generating DESIGN.md...');

    const enrichedData = {
      ...normalized,
      resolvedMap,
      brandColors,
      warnings,
      assets,
    };

    const markdown = generateDesignMd(enrichedData);

    await sendProgress(90, 'Generating STRUCTURE.md...');

    const structureData = {
      meta: normalized.meta,
      components: structureComponents,
    };
    const { markdown: structureMarkdown, capturedCount } = generateStructureMd(structureData);

    await sendProgress(93, 'Generating STYLES.md...');

    const stylesData = {
      meta: normalized.meta,
      components: structureComponents,
      rules: cssRules,
      keyframes: normalized.keyframes || {},
    };
    const stylesMarkdown = generateStylesMd(stylesData);

    await sendProgress(96, 'Generating HTML report...');

    const htmlReport = generateHtmlReport(enrichedData);

    await sendProgress(98, 'Done!');

    const summary = buildSummary(normalized, capturedCount, resolvedMap, brandColors, warnings);

    await chrome.runtime.sendMessage({
      type: 'EXTRACTION_COMPLETE',
      markdown,
      structureMarkdown,
      stylesMarkdown,
      htmlReport,
      summary,
    });

  } catch (err) {
    console.error('[Design Extractor] Error:', err);
    try {
      await chrome.runtime.sendMessage({
        type: 'EXTRACTION_ERROR',
        error: err.message || 'Unknown error during extraction.',
      });
    } catch (_e) {}
  }
}

function buildAllCssText(cssVars) {
  return Object.entries(cssVars)
    .map(([name, data]) => `${name}: ${data.value || ''};`)
    .join('\n');
}

// This function runs inside the page context (not service worker)
function runContentScript() {
  'use strict';

  // ─── CSS CUSTOM PROPERTY EXTRACTION ───────────────────────────────────────

  function extractCSSVars() {
    const vars = new Map();

    for (const sheet of document.styleSheets) {
      try {
        walkRules(sheet.cssRules, vars, sheet.href || 'inline');
      } catch (_e) {}
    }

    const rootComputed = getComputedStyle(document.documentElement);
    for (let i = 0; i < rootComputed.length; i++) {
      const prop = rootComputed[i];
      if (prop.startsWith('--')) {
        const rawVal = rootComputed.getPropertyValue(prop).trim();
        if (!vars.has(prop)) {
          vars.set(prop, { value: rawVal, rawValue: rawVal, source: ':root computed' });
        } else {
          vars.get(prop).resolvedValue = rawVal;
        }
      }
    }

    const bodyComputed = getComputedStyle(document.body);
    for (let i = 0; i < bodyComputed.length; i++) {
      const prop = bodyComputed[i];
      if (prop.startsWith('--') && !vars.has(prop)) {
        vars.set(prop, {
          value: bodyComputed.getPropertyValue(prop).trim(),
          rawValue: bodyComputed.getPropertyValue(prop).trim(),
          source: 'body computed'
        });
      }
    }

    const EXTENSION_PREFIXES = [
      '--speechify-', '--grammarly-', '--__ext-', '--loom-', '--honey-',
      '--dashlane-', '--lastpass-', '--1password-', '--bitwarden-',
      '--dark-reader-', '--ublock-', '--metamask-'
    ];
    for (const key of vars.keys()) {
      if (EXTENSION_PREFIXES.some(p => key.startsWith(p))) {
        vars.delete(key);
      }
    }

    return Object.fromEntries(vars);
  }

  function walkRules(ruleList, vars, source) {
    if (!ruleList) return;
    for (const rule of ruleList) {
      if (rule.cssRules) {
        walkRules(rule.cssRules, vars, source);
        continue;
      }
      if (rule.type !== CSSRule.STYLE_RULE) continue;
      const sel = rule.selectorText || '';
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i];
        if (prop.startsWith('--')) {
          const rawVal = rule.style.getPropertyValue(prop).trim();
          if (!vars.has(prop)) {
            vars.set(prop, { value: rawVal, rawValue: rawVal, source: `${source.slice(-60)}::${sel.slice(0, 40)}` });
          }
        }
      }
    }
  }

  // ─── KEYFRAMES EXTRACTION ─────────────────────────────────────────────────

  function extractKeyframes() {
    const keyframes = {};
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          collectKeyframes(rule, keyframes);
        }
      } catch (_e) {}
    }
    return keyframes;
  }

  function collectKeyframes(rule, keyframes) {
    if (rule.type === 7) {
      const name = rule.name;
      if (name && !keyframes[name]) {
        keyframes[name] = rule.cssText;
      }
      return;
    }
    if (rule.cssRules) {
      for (const child of rule.cssRules) {
        collectKeyframes(child, keyframes);
      }
    }
  }

  // ─── STYLESHEET WALKING ────────────────────────────────────────────────────

  function extractStylesheetData() {
    const fonts = new Set();
    const colors = new Set();
    const fontSizes = new Set();
    const spacings = new Set();
    const borderRadii = new Set();
    const shadows = new Set();
    const zIndices = new Set();
    const transitions = new Set();

    for (const sheet of document.styleSheets) {
      try {
        walkRulesForValues(sheet.cssRules, { fonts, colors, fontSizes, spacings, borderRadii, shadows, zIndices, transitions });
      } catch (_e) {}
    }

    return {
      fontFamilies: [...fonts],
      colors: [...colors],
      fontSizes: sortedValues([...fontSizes]),
      spacings: sortedValues([...spacings]),
      borderRadii: sortedValues([...borderRadii]),
      shadows: [...shadows],
      zIndices: [...zIndices].map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b),
      transitions: [...transitions],
    };
  }

  function walkRulesForValues(ruleList, acc) {
    if (!ruleList) return;
    for (const rule of ruleList) {
      if (rule.cssRules) { walkRulesForValues(rule.cssRules, acc); continue; }
      if (rule.type !== CSSRule.STYLE_RULE) continue;
      const s = rule.style;
      if (!s) continue;

      const ff = s.getPropertyValue('font-family').trim();
      if (ff && !ff.startsWith('var(')) acc.fonts.add(ff);

      const fs = s.getPropertyValue('font-size').trim();
      if (fs && !fs.startsWith('var(')) acc.fontSizes.add(fs);

      ['color', 'background-color', 'background', 'border-color', 'fill', 'stroke'].forEach(p => {
        const v = s.getPropertyValue(p).trim();
        if (v && isColorValue(v)) acc.colors.add(v);
      });

      ['margin', 'padding', 'gap', 'row-gap', 'column-gap'].forEach(p => {
        const v = s.getPropertyValue(p).trim();
        if (v && !v.startsWith('var(')) acc.spacings.add(v);
      });

      const br = s.getPropertyValue('border-radius').trim();
      if (br && !br.startsWith('var(')) acc.borderRadii.add(br);

      const bs = s.getPropertyValue('box-shadow').trim();
      if (bs && bs !== 'none' && !bs.startsWith('var(')) acc.shadows.add(bs);

      const zi = s.getPropertyValue('z-index').trim();
      if (zi && zi !== 'auto') acc.zIndices.add(zi);

      const tr = s.getPropertyValue('transition').trim();
      if (tr && tr !== 'none' && !tr.startsWith('var(')) acc.transitions.add(tr);
    }
  }

  function isColorValue(v) {
    return v.startsWith('#') || v.startsWith('rgb') || v.startsWith('hsl') ||
      v.startsWith('oklch') || v.startsWith('color(') || v.startsWith('lch(');
  }

  function sortedValues(arr) {
    const parsed = arr.map(v => v.trim()).filter(Boolean)
      .map(v => ({ raw: v, n: parseFloat(v) }));
    parsed.sort((a, b) => (isNaN(a.n) || isNaN(b.n)) ? 0 : a.n - b.n);
    return [...new Set(parsed.map(x => x.raw))];
  }

  // ─── FRAMEWORK DETECTION ──────────────────────────────────────────────────

  function detectFramework(cssVars) {
    const varNames = Object.keys(cssVars);
    const allClasses = getAllClasses();

    const scores = {
      'shadcn/ui': 0, 'Tailwind CSS': 0, 'Material UI': 0,
      'Bootstrap': 0, 'Radix UI': 0, 'Ant Design': 0, 'Chakra UI': 0,
    };

    const shadcnVars = ['--background', '--foreground', '--primary', '--primary-foreground',
      '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
      '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
      '--border', '--input', '--ring', '--radius', '--card', '--card-foreground'];
    scores['shadcn/ui'] += shadcnVars.filter(v => varNames.includes(v)).length * 3;

    const tailwindPat = /\b(?:text|bg|p[xy]?|[mp][tlrbxy]?|gap|flex|grid|w|h|rounded|border|shadow|font|ring|z|opacity)-/;
    scores['Tailwind CSS'] += Math.min(allClasses.filter(c => tailwindPat.test(c + '-')).length * 0.5, 40);
    if (varNames.some(v => v.startsWith('--tw-'))) scores['Tailwind CSS'] += 20;

    if (varNames.some(v => v.startsWith('--mui-'))) scores['Material UI'] += 30;
    if (document.querySelector('[class*="Mui"]')) scores['Material UI'] += 20;

    if (varNames.some(v => v.startsWith('--bs-'))) scores['Bootstrap'] += 30;
    if (document.querySelector('.btn') && document.querySelector('.container')) scores['Bootstrap'] += 10;

    if (varNames.some(v => v.startsWith('--radix-'))) scores['Radix UI'] += 30;
    if (document.querySelector('[data-radix-popper-content-wrapper]')) scores['Radix UI'] += 20;

    if (varNames.some(v => v.startsWith('--ant-'))) scores['Ant Design'] += 30;
    if (document.querySelector('[class*="ant-"]')) scores['Ant Design'] += 20;

    if (varNames.some(v => v.startsWith('--chakra-'))) scores['Chakra UI'] += 30;
    if (document.querySelector('[class*="chakra-"]')) scores['Chakra UI'] += 20;

    let topFramework = 'Custom Design System';
    let topScore = 5;
    for (const [name, score] of Object.entries(scores)) {
      if (score > topScore) { topScore = score; topFramework = name; }
    }

    if (scores['Tailwind CSS'] >= 10 && topFramework !== 'Tailwind CSS' && topFramework !== 'Custom Design System') {
      topFramework = `${topFramework} on Tailwind CSS`;
    }

    return { primary: topFramework, scores };
  }

  function getAllClasses() {
    const classes = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      el.className.toString().split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
    });
    return [...classes];
  }

  // ─── FONT DETECTION ───────────────────────────────────────────────────────

  function detectFonts() {
    const loaded = [];
    if (document.fonts) {
      for (const face of document.fonts) {
        loaded.push({ family: face.family.replace(/['"]/g, '').trim(), style: face.style, weight: face.weight, status: face.status });
      }
    }

    const googleFonts = [];
    const externalSources = [];
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      const href = link.href || '';
      if (href.includes('fonts.googleapis.com')) {
        const m = href.match(/family=([^&]+)/);
        if (m) {
          decodeURIComponent(m[1]).split('|').map(f => f.split(':')[0].replace(/\+/g, ' ')).forEach(f => googleFonts.push(f));
        }
        externalSources.push({ provider: 'Google Fonts', url: href });
      } else if (href.includes('use.typekit.net') || href.includes('fonts.adobe.com')) {
        externalSources.push({ provider: 'Adobe Fonts', url: href });
      } else if (href.includes('fonts.bunny.net')) {
        externalSources.push({ provider: 'Bunny Fonts', url: href });
      }
    });

    const declared = new Set();
    document.querySelectorAll('h1, h2, h3, p, a, button, input, code').forEach(el => {
      getComputedStyle(el).fontFamily.split(',').map(f => f.trim().replace(/['"]/g, '')).forEach(f => declared.add(f));
    });

    return {
      loaded: loaded.filter((f, i, a) => a.findIndex(x => x.family === f.family) === i),
      googleFonts: [...new Set(googleFonts)],
      externalSources,
      declaredFamilies: [...declared].filter(f => f && !['inherit', 'initial', 'unset'].includes(f)),
    };
  }

  // ─── COMPONENT DETECTION ──────────────────────────────────────────────────

  function detectComponents() {
    const components = { buttons: [], dialogs: [], forms: [], navs: [], cards: [], alerts: [], tables: [], inputs: [], badges: [], dropdowns: [] };

    document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]').forEach(el => {
      const classes = el.className.toString().toLowerCase();
      let variant = 'default';
      if (/ghost|outline/.test(classes)) variant = 'ghost/outline';
      else if (/destructive|danger/.test(classes)) variant = 'destructive';
      else if (/secondary/.test(classes)) variant = 'secondary';
      else if (/primary|solid/.test(classes)) variant = 'primary';
      components.buttons.push({ tag: el.tagName.toLowerCase(), variant, text: el.textContent.trim().slice(0, 50) });
    });

    document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, [aria-modal="true"], [class*="modal"], [class*="dialog"]').forEach(el => {
      const r = el.getBoundingClientRect();
      components.dialogs.push({ tag: el.tagName.toLowerCase(), visible: r.width > 0 && r.height > 0 });
    });

    document.querySelectorAll('form').forEach(el => {
      components.forms.push({ inputs: el.querySelectorAll('input, select, textarea').length });
    });

    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea').forEach(el => {
      components.inputs.push({ type: el.type || el.tagName.toLowerCase() });
    });

    document.querySelectorAll('[role="navigation"], nav').forEach(el => {
      components.navs.push({ tag: el.tagName.toLowerCase() });
    });

    document.querySelectorAll('[class*="card"], [data-slot="card"]').forEach(el => {
      components.cards.push({ tag: el.tagName.toLowerCase() });
    });

    document.querySelectorAll('[role="alert"], [class*="alert"], [class*="toast"]').forEach(el => {
      components.alerts.push({ tag: el.tagName.toLowerCase() });
    });

    document.querySelectorAll('table, [role="table"]').forEach(el => {
      components.tables.push({ rows: el.querySelectorAll('tr, [role="row"]').length });
    });

    document.querySelectorAll('[class*="badge"], [class*="chip"], [class*="tag"]').forEach(el => {
      components.badges.push({ text: el.textContent.trim().slice(0, 30) });
    });

    document.querySelectorAll('[role="listbox"], [role="combobox"], [class*="dropdown"]').forEach(el => {
      components.dropdowns.push({ tag: el.tagName.toLowerCase() });
    });

    for (const key of Object.keys(components)) components[key] = components[key].slice(0, 50);
    return components;
  }

  // ─── SPACING SCALE ────────────────────────────────────────────────────────

  function inferSpacingScale(cssVars) {
    const spacingVars = Object.entries(cssVars).filter(([k]) =>
      k.includes('spacing') || k.includes('space') || k.includes('gap') ||
      k.includes('padding') || k.includes('margin')
    );

    const vals = new Set();
    Array.from(document.querySelectorAll('*')).slice(0, 200).forEach(el => {
      try {
        const s = getComputedStyle(el);
        for (const p of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'marginTop', 'marginBottom']) {
          const v = parseFloat(s[p]);
          if (v > 0 && v <= 200) vals.add(v);
        }
        const g = parseFloat(s.gap);
        if (g > 0 && g <= 200) vals.add(g);
      } catch (_e) {}
    });

    return {
      detectedValues: [...vals].sort((a, b) => a - b).map(v => `${v}px`),
      spacingVars,
    };
  }

  // ─── CSS VAR CLASSIFICATION ───────────────────────────────────────────────

  function classifyCSSVars(cssVars) {
    const colors = {}, typography = {}, spacing = {}, radius = {}, shadow = {}, animation = {}, zIndex = {}, breakpoints = {}, other = {};

    for (const [name, data] of Object.entries(cssVars)) {
      const n = name.toLowerCase();
      const v = (data.value || '').trim();

      if (isColorValue(v) || /color|background|foreground|primary|secondary|accent|muted|border|ring|fill|stroke|surface|brand|success|warning|error|danger|info|destructive|neutral|canvas|card|popover|input|chart|sidebar/.test(n)) {
        colors[name] = data;
      } else if (/font|text|type|weight|size|line-height|letter/.test(n)) {
        typography[name] = data;
      } else if (/spacing|space|gap|padding|margin|inset/.test(n)) {
        spacing[name] = data;
      } else if (/radius|rounded|corner/.test(n)) {
        radius[name] = data;
      } else if (/shadow|elevation/.test(n)) {
        shadow[name] = data;
      } else if (/duration|easing|timing|transition|animation/.test(n)) {
        animation[name] = data;
      } else if (/z-index|zindex|layer/.test(n)) {
        zIndex[name] = data;
      } else if (/breakpoint|screen|viewport/.test(n)) {
        breakpoints[name] = data;
      } else {
        other[name] = data;
      }
    }
    return { colors, typography, spacing, radius, shadow, animation, zIndex, breakpoints, other };
  }

  // ─── HTML SNAPSHOT (for brand color analysis) ─────────────────────────────

  function captureHtmlSnapshot() {
    try {
      return document.documentElement.outerHTML.slice(0, 500000);
    } catch (_e) {
      return '';
    }
  }

  // ─── MAIN ─────────────────────────────────────────────────────────────────

  const cssVars = extractCSSVars();
  const stylesheetData = extractStylesheetData();
  const framework = detectFramework(cssVars);
  const fonts = detectFonts();
  const components = detectComponents();
  const spacing = inferSpacingScale(cssVars);
  const classified = classifyCSSVars(cssVars);

  return {
    meta: {
      title: document.title,
      url: window.location.href,
      hostname: window.location.hostname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
      timestamp: new Date().toISOString(),
    },
    cssVars,
    classified,
    stylesheetData,
    keyframes: extractKeyframes(),
    framework,
    fonts,
    components,
    spacing,
    htmlSnapshot: captureHtmlSnapshot(),
  };
}

// ─── ASSET EXTRACTION SCRIPT ─────────────────────────────────────────────────
function runAssetScript() {
  'use strict';

  const images = [];
  const svgs = [];
  const icons = [];
  const seen = new Set();

  document.querySelectorAll('img').forEach(el => {
    const src = el.currentSrc || el.src;
    if (!src || seen.has(src) || src.startsWith('data:')) return;
    seen.add(src);
    const r = el.getBoundingClientRect();
    images.push({ src, alt: el.alt || '', width: el.naturalWidth || r.width, height: el.naturalHeight || r.height, visible: r.width > 0 && r.height > 0 });
  });

  document.querySelectorAll('picture source').forEach(el => {
    const srcset = el.srcset;
    if (!srcset) return;
    srcset.split(',').forEach(entry => {
      const url = entry.trim().split(/\s+/)[0];
      if (url && !seen.has(url) && !url.startsWith('data:')) {
        seen.add(url);
        images.push({ src: url, alt: '', width: 0, height: 0, visible: true });
      }
    });
  });

  document.querySelectorAll('svg').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const html = el.outerHTML;
    const hash = html.length.toString(36) + html.slice(0, 40).replace(/\s+/g, '').length.toString(36);
    if (seen.has('svg:' + hash)) return;
    seen.add('svg:' + hash);
    const isIcon = r.width <= 48 && r.height <= 48;
    const entry = { html: html.length > 2000 ? html.slice(0, 2000) + '...' : html, width: Math.round(r.width), height: Math.round(r.height), viewBox: el.getAttribute('viewBox') || '', isIcon };
    svgs.push(entry);
    if (isIcon) icons.push(entry);
  });

  document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').forEach(el => {
    const href = el.href;
    if (!href || seen.has(href)) return;
    seen.add(href);
    icons.push({ src: href, rel: el.rel, sizes: el.getAttribute('sizes') || '', type: el.type || '' });
  });

  const logoCandidates = [];
  document.querySelectorAll('header a, [role="banner"] a, nav:first-of-type a').forEach(el => {
    const img = el.querySelector('img, svg');
    if (!img) return;
    const r = img.getBoundingClientRect();
    if (r.width < 20 || r.height < 10 || r.width > 600) return;
    const isSvg = img.tagName === 'SVG';
    logoCandidates.push({ tag: img.tagName.toLowerCase(), src: isSvg ? '' : (img.currentSrc || img.src || ''), svgHtml: isSvg ? img.outerHTML.slice(0, 3000) : '', width: Math.round(r.width), height: Math.round(r.height), alt: img.alt || '' });
  });

  return { images: images.slice(0, 50), svgs: svgs.slice(0, 30), icons: icons.slice(0, 30), logo: logoCandidates[0] || null };
}

function normalizeData(data) {
  return {
    meta: data.meta || { title: '', url: '', hostname: 'unknown', viewport: '', darkMode: false, timestamp: new Date().toISOString() },
    cssVars: data.cssVars || {},
    classified: data.classified || { colors: {}, typography: {}, spacing: {}, radius: {}, shadow: {}, animation: {}, zIndex: {}, breakpoints: {}, other: {} },
    stylesheetData: data.stylesheetData || { fontFamilies: [], colors: [], fontSizes: [], spacings: [], borderRadii: [], shadows: [], zIndices: [], transitions: [] },
    framework: data.framework || { primary: 'Custom Design System', scores: {} },
    fonts: data.fonts || { loaded: [], googleFonts: [], externalSources: [], declaredFamilies: [] },
    components: data.components || { buttons: [], dialogs: [], forms: [], navs: [], cards: [], alerts: [], tables: [], inputs: [], badges: [], dropdowns: [] },
    spacing: data.spacing || { detectedValues: [], spacingVars: [] },
    keyframes: data.keyframes || {},
    htmlSnapshot: data.htmlSnapshot || '',
  };
}

function buildSummary(data, capturedCount, resolvedMap, brandColors, warnings) {
  const cssVarCount = Object.keys(data.cssVars).length;
  const colorCount = Object.keys(data.classified.colors).length;
  const loadedFamilies = [...new Set(data.fonts.loaded.map(f => f.family))];
  const fontCount = loadedFamilies.length || data.fonts.googleFonts.length || data.fonts.declaredFamilies.length;
  const componentCount = Object.values(data.components).reduce((sum, arr) => sum + arr.length, 0);

  return {
    cssVarCount,
    colorCount,
    fontCount,
    componentCount,
    capturedCount,
    framework: data.framework.primary,
    resolvedCount: resolvedMap ? resolvedMap.resolvedCount : 0,
    totalVars: resolvedMap ? resolvedMap.totalVars : cssVarCount,
    brandColor: brandColors ? brandColors.brandColor : null,
    warningCount: warnings ? warnings.length : 0,
  };
}

// ─── STRUCTURE EXTRACTION SCRIPT ─────────────────────────────────────────────
function runStructureScript() {
  'use strict';

  const MAX_DEPTH = 6;

  function skeletonize(el, depth) {
    if (depth > MAX_DEPTH) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return null;
    if (tag === 'iframe') { try { void el.contentDocument; } catch (_e) { return null; } }

    const attrs = [];
    const KEEP_ATTRS = new Set(['class', 'id', 'role', 'type', 'aria-label', 'aria-expanded',
      'aria-haspopup', 'aria-controls', 'aria-current', 'aria-selected', 'aria-hidden',
      'aria-labelledby', 'aria-describedby', 'tabindex', 'for', 'name', 'method']);
    const URL_ATTRS = new Set(['href', 'src', 'action']);

    for (const attr of el.attributes) {
      const name = attr.name;
      if (KEEP_ATTRS.has(name)) { attrs.push(`${name}="${escapeAttr(attr.value)}"`); }
      else if (URL_ATTRS.has(name)) { attrs.push(`${name}="[URL]"`); }
      else if (name === 'placeholder') { attrs.push(`placeholder="[TEXT]"`); }
      else if (name === 'alt') { attrs.push(`alt="[TEXT]"`); }
    }

    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
    const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    if (VOID_TAGS.has(tag)) return `<${tag}${attrStr}>`;

    const childParts = [];
    let hasTextChild = false;
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { if (child.textContent.trim()) hasTextChild = true; }
      else if (child.nodeType === Node.ELEMENT_NODE) { const h = skeletonize(child, depth + 1); if (h !== null) childParts.push(h); }
    }
    if (hasTextChild && childParts.length === 0) childParts.push('[TEXT]');
    else if (hasTextChild) { const dt = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()).length > 0; if (dt) childParts.unshift('[TEXT]'); }
    if (childParts.length === 0) return `<${tag}${attrStr}></${tag}>`;
    const innerLines = childParts.join('\n').split('\n').map(line => '  ' + line).join('\n');
    return `<${tag}${attrStr}>\n${innerLines}\n</${tag}>`;
  }

  function escapeAttr(val) { return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function captureElement(el) { if (!el) return null; try { return skeletonize(el, 0); } catch (_e) { return null; } }

  function findNav() {
    const candidates = [document.querySelector('header nav'), document.querySelector('nav[role="navigation"]'), document.querySelector('[role="navigation"]'), document.querySelector('nav'), document.querySelector('header')];
    for (const el of candidates) { if (el) return el; }
    return null;
  }

  function findHero() {
    const h1 = document.querySelector('h1');
    if (h1) { let el = h1.parentElement; while (el && el !== document.body) { const tag = el.tagName.toLowerCase(); if (tag === 'section' || tag === 'main' || el.getAttribute('role') === 'main') return el; if (tag === 'div' && el.children.length >= 2) return el; el = el.parentElement; } return h1.parentElement; }
    return document.querySelector('main > *:first-child') || document.querySelector('section') || null;
  }

  function findCard() {
    for (const sel of ['[class*="card"]', 'article', '[data-slot="card"]']) { const cards = document.querySelectorAll(sel); for (const card of cards) { if (card.children.length >= 2) return card; } if (cards.length > 0) return cards[0]; }
    return null;
  }

  function findCTA() {
    const buttons = document.querySelectorAll('button, a[class*="btn"], a[class*="button"]');
    const primaryPat = /primary|cta|hero|action|get-started|signup|sign-up|try|start/i;
    for (const btn of buttons) { if (primaryPat.test(btn.className.toString())) return btn; }
    for (const btn of buttons) { const r = btn.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return btn; }
    return buttons[0] || null;
  }

  function findFooter() { return document.querySelector('footer') || null; }

  const result = {};
  const nav = findNav(); if (nav) { const html = captureElement(nav); if (html) result.nav = html; }
  const hero = findHero(); if (hero) { const html = captureElement(hero); if (html) result.hero = html; }
  const card = findCard(); if (card) { const html = captureElement(card); if (html) result.card = html; }
  const cta = findCTA(); if (cta) { const html = captureElement(cta); if (html) result.cta = html; }
  const footer = findFooter(); if (footer) { const html = captureElement(footer); if (html) result.footer = html; }
  return result;
}

// ─── STYLES EXTRACTION SCRIPT ────────────────────────────────────────────────
function runStylesScript(structureComponents) {
  'use strict';

  const VISUAL_PROPS = [
    'display','position','top','right','bottom','left','z-index',
    'width','height','min-width','max-width','min-height','max-height',
    'flex','flex-direction','flex-wrap','align-items','align-self','justify-content','justify-self','gap','flex-shrink','flex-grow',
    'grid-template-columns','grid-template-rows','grid-column','grid-row',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'border','border-top','border-right','border-bottom','border-left',
    'border-radius','border-color','border-width','border-style',
    'background','background-color','background-image','background-size','background-position',
    'color','opacity','visibility','overflow','overflow-x','overflow-y',
    'font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-decoration','text-transform','white-space',
    'box-shadow','outline','cursor','pointer-events',
    'transition','animation','transform',
    'list-style','object-fit','object-position',
  ];

  function extractClassNamesFromHtml(htmlString) {
    const classNames = new Set();
    for (const match of htmlString.matchAll(/class="([^"]+)"/g)) { match[1].split(/\s+/).forEach(cls => cls && classNames.add(cls)); }
    return classNames;
  }

  const allClassNames = new Set();
  for (const html of Object.values(structureComponents)) { if (html) extractClassNamesFromHtml(html).forEach(c => allClassNames.add(c)); }
  if (allClassNames.size === 0) return {};

  const SKIP_VALUES = new Set(['', 'none', 'normal', 'auto', 'initial', 'unset', 'inherit', '0px', 'rgba(0, 0, 0, 0)', 'transparent']);

  function getComputedStyleBlock(el) {
    const cs = window.getComputedStyle(el);
    const decls = [];
    for (const prop of VISUAL_PROPS) { const val = cs.getPropertyValue(prop).trim(); if (!val || SKIP_VALUES.has(val)) continue; decls.push(`  ${prop}: ${val};`); }
    return decls.join('\n');
  }

  const result = {};
  for (const cls of allClassNames) {
    if (cls.startsWith('w-node-') || cls === 'w-embed' || cls.length < 3) continue;
    const el = document.querySelector(`.${CSS.escape(cls)}`);
    if (!el) continue;
    const block = getComputedStyleBlock(el);
    if (!block) continue;
    result[cls] = `.${cls} {\n${block}\n}`;
  }
  return result;
}
