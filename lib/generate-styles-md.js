// Generates a STYLES.md document from extracted CSS rules for component classes

const MAX_RULES = 800;

// Sections correspond to the structural components captured in STRUCTURE.md
const SECTION_ORDER = [
  { key: 'nav',    label: 'Navigation Styles' },
  { key: 'hero',   label: 'Hero Styles' },
  { key: 'card',   label: 'Card Styles' },
  { key: 'cta',    label: 'CTA Button Styles' },
  { key: 'footer', label: 'Footer Styles' },
  { key: 'other',  label: 'Other Styles' },
];

/**
 * Extract all class names from a skeletonized HTML string.
 * Returns a Set<string> of bare class names (no dots).
 */
function extractClassNamesFromHtml(htmlString) {
  const classNames = new Set();
  const matches = htmlString.matchAll(/class="([^"]+)"/g);
  for (const match of matches) {
    match[1].split(/\s+/).forEach(cls => cls && classNames.add(cls));
  }
  return classNames;
}

/**
 * Walk a CSSRuleList and collect rules whose selectors mention any of the
 * target class names. Rules that only set custom properties are skipped.
 *
 * @param {CSSRuleList} ruleList
 * @param {Set<string>} classNames  — bare names without dots
 * @param {Object} rules            — accumulated { key -> cssText }
 * @param {string} mediaContext     — e.g. "@media (max-width: 991px)"
 */
// NOTE: This function is serialized and injected into the page context.
// It must be self-contained — no closure references to outer scope are allowed.

/**
 * Build a map of sectionKey -> Set<className> by splitting the components
 * object (which maps sectionKey -> HTML skeleton string).
 */
function buildSectionClassMap(components) {
  const map = {};
  for (const [key, html] of Object.entries(components)) {
    if (html) {
      map[key] = extractClassNamesFromHtml(html);
    }
  }
  return map;
}

/**
 * Given the flat rules object ({ key -> cssText }) returned by the page
 * script, assign each rule to a section based on which component's class
 * set contains the target class name in the selector.
 *
 * Rules that don't match any known component section go into "other".
 * Responsive rules (keys starting with "@media") are collected separately.
 */
function assignRulesToSections(rules, sectionClassMap) {
  // sections: nav | hero | card | cta | footer | other
  // responsive: separate bucket
  const sections = {};
  for (const { key } of SECTION_ORDER) {
    sections[key] = [];
  }
  const responsive = [];

  for (const [ruleKey, cssText] of Object.entries(rules)) {
    const isResponsive = ruleKey.startsWith('@media') || ruleKey.startsWith('@supports');

    if (isResponsive) {
      responsive.push({ ruleKey, cssText });
      continue;
    }

    // Determine which section this rule belongs to
    // ruleKey is the bare class name (no dot) in the computed-style approach
    let assigned = false;
    for (const [sectionKey, classSet] of Object.entries(sectionClassMap)) {
      for (const cls of classSet) {
        if (ruleKey === cls || ruleKey.includes(`.${cls}`)) {
          if (sections[sectionKey]) {
            sections[sectionKey].push({ ruleKey, cssText });
          } else {
            sections.other.push({ ruleKey, cssText });
          }
          assigned = true;
          break;
        }
      }
      if (assigned) break;
    }

    if (!assigned) {
      sections.other.push({ ruleKey, cssText });
    }
  }

  return { sections, responsive };
}

/**
 * Format a single CSS rule for display. Indent declarations, keep selector
 * on its own line for readability.
 */
function formatRule(cssText) {
  // cssText is already the full rule string from the browser.
  // Normalize whitespace slightly for readability.
  return cssText
    .replace(/\s*\{\s*/g, ' {\n  ')
    .replace(/;\s*/g, ';\n  ')
    .replace(/\s*\}\s*/g, '\n}')
    .replace(/  $/, '') // trailing indent before closing brace
    .trim();
}

/**
 * Main entry point.
 * @param {Object} data
 *   data.meta       — { hostname, url, ... }
 *   data.components — { nav, hero, card, cta, footer } — HTML skeletons
 *   data.rules      — { selectorKey -> cssText } — from page extraction
 */
export function generateStylesMd(data) {
  const { meta, components, rules, keyframes } = data;

  if (!rules || Object.keys(rules).length === 0) {
    const h1 = meta.hostname.replace(/^www\./, '');
    return `# ${h1} Component Styles\n\n> Extracted from ${meta.url}\n\nNo component CSS rules were extracted.\n`;
  }

  const h1 = meta.hostname.replace(/^www\./, '');
  const sectionClassMap = buildSectionClassMap(components || {});

  // Apply the 800-rule cap, sorted by selector length (shorter = more foundational)
  const allRuleEntries = Object.entries(rules);
  allRuleEntries.sort((a, b) => a[0].length - b[0].length);
  const cappedRules = Object.fromEntries(allRuleEntries.slice(0, MAX_RULES));

  const { sections, responsive } = assignRulesToSections(cappedRules, sectionClassMap);

  const totalRules = Object.values(sections).reduce((s, arr) => s + arr.length, 0) + responsive.length;
  const totalClassCount = Object.values(sectionClassMap).reduce((s, set) => s + set.size, 0);

  const lines = [];
  lines.push(`# ${h1} Component Styles`);
  lines.push('');
  lines.push(`> Extracted from ${meta.url}`);
  lines.push(`> ${totalRules} CSS rules extracted for ${totalClassCount} component classes`);
  lines.push('');
  lines.push('<!-- Generated by Design System Extractor Chrome Extension -->');
  lines.push('');

  let hasContent = false;

  for (const { key, label } of SECTION_ORDER) {
    const sectionRules = sections[key];
    if (!sectionRules || sectionRules.length === 0) continue;

    hasContent = true;
    lines.push(`## ${label}`);
    lines.push('');
    lines.push('```css');
    for (const { cssText } of sectionRules) {
      lines.push(formatRule(cssText));
      lines.push('');
    }
    lines.push('```');
    lines.push('');
  }

  if (responsive.length > 0) {
    hasContent = true;
    lines.push('## Responsive Overrides');
    lines.push('');
    lines.push('```css');
    for (const { cssText } of responsive) {
      lines.push(formatRule(cssText));
      lines.push('');
    }
    lines.push('```');
    lines.push('');
  }

  // Keyframes section
  const keyframeEntries = Object.entries(keyframes || {});
  if (keyframeEntries.length > 0) {
    hasContent = true;
    lines.push('## Keyframe Animations');
    lines.push('');
    lines.push('```css');
    for (const [, cssText] of keyframeEntries.slice(0, 60)) {
      lines.push(cssText);
      lines.push('');
    }
    lines.push('```');
    lines.push('');
  }

  if (!hasContent) {
    lines.push('No component CSS rules matched the extracted class names.');
    lines.push('');
  }

  lines.push('## Using This File');
  lines.push('');
  lines.push('Paste alongside DESIGN.md and STRUCTURE.md:');
  lines.push('');
  lines.push('```');
  lines.push('Use STYLES.md for the exact CSS rules for each component class. Combined with DESIGN.md tokens and STRUCTURE.md HTML skeletons, this gives a complete picture for faithful recreation.');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}
