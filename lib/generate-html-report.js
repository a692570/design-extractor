// Generates an interactive HTML report with color swatches, typography preview,
// spacing bars, and shadow demos — inspired by insane-design's report.html

export function generateHtmlReport(data) {
  const { meta, cssVars, classified, resolvedMap, brandColors, stylesheetData, fonts, spacing, warnings, assets } = data;
  const h1 = meta.hostname.replace(/^www\./, '');
  const brandHex = (brandColors && brandColors.brandColor) || '#6366f1';

  const brandFontFamilies = [...new Set((fonts.loaded || []).map(f => f.family))].slice(0, 2);
  const bodyFont = brandFontFamilies.length > 1 ? brandFontFamilies[1] : (brandFontFamilies[0] || 'Inter, sans-serif');
  const headFont = brandFontFamilies[0] || bodyFont;

  let sections = '';

  // ── PROVENANCE ─────────────────────────────────────────────────────────────
  sections += section('Provenance', `
    <div class="provenance">
      <div class="prov-row"><span class="prov-label">Source</span><span class="prov-value"><a href="${esc(meta.url)}" target="_blank">${esc(meta.url)}</a></span></div>
      <div class="prov-row"><span class="prov-label">Extracted</span><span class="prov-value">${esc(meta.timestamp)}</span></div>
      <div class="prov-row"><span class="prov-label">Framework</span><span class="prov-value">${esc(data.framework?.primary || 'Custom')}</span></div>
      <div class="prov-row"><span class="prov-label">CSS Variables</span><span class="prov-value">${Object.keys(cssVars).length}</span></div>
      ${resolvedMap ? `<div class="prov-row"><span class="prov-label">Resolved</span><span class="prov-value">${resolvedMap.resolvedCount} / ${resolvedMap.totalVars}</span></div>` : ''}
    </div>
  `);

  // ── BRAND COLOR ────────────────────────────────────────────────────────────
  if (brandColors) {
    let brandHtml = '';
    if (brandColors.brandColor) {
      brandHtml += `<div class="brand-swatch" style="background:${brandColors.brandColor}" onclick="copySwatch(this,'${brandColors.brandColor}')">
        <span class="swatch-label" style="color:${hexLightness(brandColors.brandColor) > 55 ? '#000' : '#fff'}">${brandColors.brandColor}</span>
      </div>`;
    }

    if (brandColors.brandCandidates && brandColors.brandCandidates.length > 0) {
      brandHtml += '<div class="swatch-row">';
      for (const c of brandColors.brandCandidates.slice(0, 5)) {
        const textColor = hexLightness(c.hex) > 55 ? '#000' : '#fff';
        brandHtml += `<div class="swatch-sm" style="background:${c.hex}" onclick="copySwatch(this,'${c.hex}')">
          <span style="color:${textColor}">${c.hex}</span>
          <span class="swatch-source">${esc(c.source)}</span>
        </div>`;
      }
      brandHtml += '</div>';
    }

    if (brandColors.contaminated && brandColors.contaminated.length > 0) {
      brandHtml += '<div class="contaminated-note"><strong>Filtered out</strong> (logo wall / SVG contamination): ';
      brandHtml += brandColors.contaminated.slice(0, 5).map(c => `<span class="hex-tag">${c.hex}</span>`).join(' ');
      if (brandColors.contaminated.length > 5) brandHtml += ` +${brandColors.contaminated.length - 5} more`;
      brandHtml += '</div>';
    }

    sections += section('Brand Color', brandHtml);
  }

  // ── COLOR RAMP ─────────────────────────────────────────────────────────────
  if (brandColors && brandColors.colorRamp) {
    let rampHtml = '';
    const { colorRamp } = brandColors;

    const brandRamp = colorRamp.brand;
    if (brandRamp && brandRamp.length > 0) {
      rampHtml += '<div class="ramp"><div class="ramp-label">Brand ramp</div><div class="ramp-colors">';
      for (const c of brandRamp) {
        const textColor = c.light > 55 ? '#000' : '#fff';
        rampHtml += `<div class="ramp-swatch" style="background:${c.hex}" onclick="copySwatch(this,'${c.hex}')">
          <span style="color:${textColor}">${c.hex}</span>
        </div>`;
      }
      rampHtml += '</div></div>';
    }

    const otherRamps = Object.entries(colorRamp).filter(([k]) => k !== 'brand').sort((a, b) => Number(a[0]) - Number(b[0]));
    for (const [bucket, colors] of otherRamps.slice(0, 6)) {
      rampHtml += `<div class="ramp"><div class="ramp-label">Hue ~${bucket}°</div><div class="ramp-colors">`;
      for (const c of colors) {
        const textColor = c.light > 55 ? '#000' : '#fff';
        rampHtml += `<div class="ramp-swatch" style="background:${c.hex}" onclick="copySwatch(this,'${c.hex}')">
          <span style="color:${textColor}">${c.hex}</span>
        </div>`;
      }
      rampHtml += '</div></div>';
    }

    if (rampHtml) sections += section('Color Ramp', rampHtml);
  }

  // ── TYPOGRAPHY ──────────────────────────────────────────────────────────────
  let typoHtml = '';
  const loadedFonts = [...new Set((fonts.loaded || []).map(f => f.family))];
  if (loadedFonts.length) {
    typoHtml += '<div class="font-list">';
    for (const family of loadedFonts) {
      const weights = (fonts.loaded || []).filter(f => f.family === family).map(f => f.weight);
      typoHtml += `<div class="font-entry">
        <div class="font-name">${esc(family)}</div>
        <div class="font-preview" style="font-family:'${esc(family)}',sans-serif">The quick brown fox jumps over the lazy dog</div>
        <div class="font-weights">${[...new Set(weights)].sort((a, b) => a - b).join(', ')}</div>
      </div>`;
    }
    typoHtml += '</div>';
  }

  if (stylesheetData.fontSizes && stylesheetData.fontSizes.length) {
    typoHtml += '<div class="scale-list">';
    for (const size of stylesheetData.fontSizes.slice(0, 12)) {
      const pxVal = parseFloat(size);
      if (isNaN(pxVal) || pxVal < 8 || pxVal > 120) continue;
      typoHtml += `<div class="scale-entry">
        <div class="scale-preview" style="font-size:${pxVal}px;line-height:1.2;max-width:400px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Aa</div>
        <div class="scale-value">${esc(size)}</div>
      </div>`;
    }
    typoHtml += '</div>';
  }

  if (typoHtml) sections += section('Typography', typoHtml);

  // ── SPACING ────────────────────────────────────────────────────────────────
  if (spacing.detectedValues && spacing.detectedValues.length) {
    let spacingHtml = '<div class="spacing-scale">';
    for (const val of spacing.detectedValues) {
      const px = parseFloat(val);
      if (isNaN(px) || px <= 0) continue;
      const barWidth = Math.min(px * 3, 300);
      spacingHtml += `<div class="spacing-entry">
        <div class="spacing-bar" style="width:${barWidth}px"></div>
        <span class="spacing-value">${esc(val)}</span>
      </div>`;
    }
    spacingHtml += '</div>';
    sections += section('Spacing', spacingHtml);
  }

  // ── SHADOWS ────────────────────────────────────────────────────────────────
  if (stylesheetData.shadows && stylesheetData.shadows.length) {
    let shadowHtml = '<div class="shadow-grid">';
    for (const shadow of stylesheetData.shadows.slice(0, 8)) {
      shadowHtml += `<div class="shadow-card" style="box-shadow:${esc(shadow)}">
        <div class="shadow-css">${esc(shadow)}</div>
      </div>`;
    }
    shadowHtml += '</div>';
    sections += section('Shadows', shadowHtml);
  }

  // ── BORDER RADIUS ──────────────────────────────────────────────────────────
  if (stylesheetData.borderRadii && stylesheetData.borderRadii.length) {
    let radiusHtml = '<div class="radius-grid">';
    for (const r of stylesheetData.borderRadii.slice(0, 8)) {
      radiusHtml += `<div class="radius-card">
        <div class="radius-preview" style="border-radius:${esc(r)};border:2px solid #6366f1;width:60px;height:60px"></div>
        <div class="radius-value">${esc(r)}</div>
      </div>`;
    }
    radiusHtml += '</div>';
    sections += section('Border Radius', radiusHtml);
  }

  // ── PITFALLS / WARNINGS ────────────────────────────────────────────────────
  if (warnings && warnings.length) {
    let warnHtml = '<div class="warnings">';
    for (const w of warnings) {
      warnHtml += `<div class="warning-item">
        <div class="warning-type">${esc(w.type.replace(/_/g, ' '))}</div>
        <div class="warning-msg">${esc(w.message)}</div>
      </div>`;
    }
    warnHtml += '</div>';
    sections += section('Pitfalls & Warnings', warnHtml);
  }

  // ── ASSETS ──────────────────────────────────────────────────────────────────
  if (assets) {
    let assetHtml = '';

    if (assets.logo) {
      assetHtml += '<div class="asset-section"><h4>Logo</h4>';
      if (assets.logo.src) {
        assetHtml += `<img src="${esc(assets.logo.src)}" style="max-height:60px" alt="Logo" onerror="this.style.display='none'">`;
      }
      if (assets.logo.svgHtml) {
        assetHtml += `<div class="svg-preview">${assets.logo.svgHtml}</div>`;
      }
      assetHtml += `<div class="asset-meta">${assets.logo.width}×${assets.logo.height}px</div></div>`;
    }

    if (assets.icons && assets.icons.length) {
      assetHtml += `<div class="asset-section"><h4>Icons (${assets.icons.length})</h4><div class="icon-grid">`;
      for (const icon of assets.icons.slice(0, 20)) {
        if (icon.html) {
          assetHtml += `<div class="icon-preview">${icon.html}</div>`;
        } else if (icon.src) {
          assetHtml += `<div class="icon-preview"><img src="${esc(icon.src)}" style="max-width:32px;max-height:32px" alt="" onerror="this.style.display='none'"></div>`;
        }
      }
      assetHtml += '</div></div>';
    }

    if (assetHtml) sections += section('Assets', assetHtml);
  }

  // ── DROP-IN CSS ─────────────────────────────────────────────────────────────
  let dropInCss = ':root {\n';
  const colorEntries = Object.entries(classified.colors || {});
  for (const [name, data] of colorEntries) {
    const resolved = resolvedMap && resolvedMap.vars[name] ? resolvedMap.vars[name].resolvedTerminal : (data.resolvedValue || data.value);
    dropInCss += `  ${name}: ${resolved};\n`;
  }
  const typoEntries = Object.entries(classified.typography || {});
  for (const [name, data] of typoEntries) {
    dropInCss += `  ${name}: ${data.resolvedValue || data.value};\n`;
  }
  const spacingEntries = Object.entries(classified.spacing || {});
  for (const [name, data] of spacingEntries) {
    dropInCss += `  ${name}: ${data.resolvedValue || data.value};\n`;
  }
  const radiusEntries = Object.entries(classified.radius || {});
  for (const [name, data] of radiusEntries) {
    dropInCss += `  ${name}: ${data.resolvedValue || data.value};\n`;
  }
  dropInCss += '}';

  sections += section('Drop-in CSS', `<pre class="code-block">${esc(dropInCss)}</pre>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(h1)} — Design System Report</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:${esc(bodyFont)},-apple-system,system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;line-height:1.6;padding:0}
.hero{background:linear-gradient(135deg,#0a0a0f 0%,#1a1a2e 100%);padding:48px 32px;border-bottom:1px solid #1e1e3f}
.hero h1{font-family:${esc(headFont)},sans-serif;font-size:28px;font-weight:700;color:#f1f5f9;margin-bottom:8px}
.hero p{color:#94a3b8;font-size:14px}
.hero .brand-dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:${brandHex};vertical-align:middle;margin-right:8px}
.container{max-width:960px;margin:0 auto;padding:24px 32px}
.section{margin-bottom:32px;border:1px solid #1e1e3f;border-radius:12px;overflow:hidden}
.section-header{background:#12121f;padding:14px 20px;font-size:14px;font-weight:600;color:#c4b5fd;letter-spacing:0.02em;text-transform:uppercase;border-bottom:1px solid #1e1e3f}
.section-body{padding:20px;background:#0f0f18}
.provenance{display:flex;flex-direction:column;gap:6px}
.prov-row{display:flex;gap:12px;font-size:13px}
.prov-label{color:#64748b;min-width:120px}
.prov-value{color:#e2e8f0}
.prov-value a{color:#818cf8;text-decoration:none}
.brand-swatch{height:80px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-bottom:12px;transition:transform .15s}
.brand-swatch:hover{transform:scale(1.02)}
.swatch-label{font-weight:700;font-size:16px}
.swatch-row{display:flex;gap:8px;flex-wrap:wrap}
.swatch-sm{flex:1;min-width:100px;border-radius:8px;padding:12px;cursor:pointer;transition:transform .15s}
.swatch-sm:hover{transform:scale(1.03)}
.swatch-sm span{font-size:11px;font-weight:600}
.swatch-source{display:block;font-size:9px;opacity:.6;margin-top:4px}
.contaminated-note{margin-top:12px;font-size:11px;color:#64748b;border-top:1px solid #1e1e3f;padding-top:8px}
.hex-tag{background:#1a1a2e;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:10px;margin:0 2px}
.ramp{margin-bottom:16px}
.ramp-label{font-size:12px;color:#94a3b8;margin-bottom:6px}
.ramp-colors{display:flex;border-radius:8px;overflow:hidden}
.ramp-swatch{flex:1;min-height:48px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:6px;cursor:pointer;transition:transform .15s}
.ramp-swatch:hover{transform:scaleY(1.1)}
.ramp-swatch span{font-size:9px;font-weight:600}
.font-list{display:flex;flex-direction:column;gap:12px}
.font-entry{background:#12121f;border-radius:8px;padding:12px 16px}
.font-name{font-weight:700;font-size:13px;color:#c4b5fd;margin-bottom:4px}
.font-preview{font-size:18px;color:#e2e8f0;margin-bottom:4px}
.font-weights{font-size:11px;color:#64748b}
.scale-list{display:flex;flex-direction:column;gap:4px}
.scale-entry{display:flex;align-items:baseline;gap:12px}
.scale-preview{color:#e2e8f0;min-width:60px}
.scale-value{font-size:11px;color:#64748b;font-family:monospace}
.spacing-scale{display:flex;flex-direction:column;gap:6px}
.spacing-entry{display:flex;align-items:center;gap:12px}
.spacing-bar{height:16px;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:4px;min-width:4px}
.spacing-value{font-size:11px;color:#64748b;font-family:monospace;min-width:60px}
.shadow-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.shadow-card{background:#fff;min-height:80px;border-radius:8px;display:flex;align-items:flex-end;padding:8px}
.shadow-css{font-size:9px;color:#333;font-family:monospace;word-break:break-all}
.radius-grid{display:flex;gap:16px;flex-wrap:wrap}
.radius-card{display:flex;flex-direction:column;align-items:center;gap:8px}
.radius-preview{background:#12121f}
.radius-value{font-size:11px;color:#64748b;font-family:monospace}
.warnings{display:flex;flex-direction:column;gap:10px}
.warning-item{background:#1a1a0f;border:1px solid #3f3f1e;border-radius:8px;padding:12px 16px}
.warning-type{font-size:11px;color:#fbbf24;font-weight:600;text-transform:uppercase;margin-bottom:4px}
.warning-msg{font-size:12px;color:#d4d4d8}
.asset-section{margin-bottom:16px}
.asset-section h4{font-size:13px;color:#94a3b8;margin-bottom:8px}
.asset-meta{font-size:11px;color:#64748b}
.icon-grid{display:flex;gap:8px;flex-wrap:wrap}
.icon-preview{width:40px;height:40px;background:#1a1a2e;border-radius:6px;display:flex;align-items:center;justify-content:center}
.icon-preview svg{width:24px;height:24px}
.svg-preview{max-width:200px;margin:8px 0}
.code-block{background:#0a0a0f;border:1px solid #1e1e3f;border-radius:8px;padding:16px;font-size:11px;font-family:'SF Mono',Monaco,monospace;color:#a5b4fc;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
</style>
</head>
<body>
<div class="hero">
  <h1><span class="brand-dot"></span>${esc(h1)}</h1>
  <p>Design system extracted ${meta.timestamp ? meta.timestamp.slice(0, 10) : ''} — click any swatch to copy hex value</p>
</div>
<div class="container">
${sections}
</div>
<script>
function copySwatch(el,hex){navigator.clipboard.writeText(hex).then(()=>{const orig=el.style.outline;el.style.outline='2px solid #22c55e';setTimeout(()=>{el.style.outline=orig},600)})}
</script>
</body>
</html>`;
}

function section(title, bodyHtml) {
  return `<div class="section"><div class="section-header">${title}</div><div class="section-body">${bodyHtml}</div></div>`;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hexLightness(hex) {
  if (!hex || !hex.startsWith('#')) return 50;
  const h = hex.replace('#', '');
  if (h.length < 6) return 50;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255 * 100;
}
