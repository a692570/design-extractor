// Popup controller — handles UI states and communicates with service worker

const $ = (id) => document.getElementById(id);

let combinedMarkdown = '';
let siteSlug = 'design-system';

function showState(name) {
  ['idle', 'loading', 'result', 'error'].forEach(s => {
    $(`${s}-state`).classList.toggle('hidden', s !== name);
  });
}

function setProgress(pct, msg) {
  $('progress-fill').style.width = `${pct}%`;
  if (msg) $('loading-msg').textContent = msg;
}

function renderStats(summary) {
  const grid = $('stats-grid');
  grid.innerHTML = '';

  const items = [
    { value: summary.cssVarCount, label: 'CSS Variables' },
    { value: summary.colorCount, label: 'Colors' },
    { value: summary.fontCount, label: 'Font Families' },
    { value: summary.componentCount, label: 'Components' },
    { value: summary.capturedCount || 0, label: 'Captured' },
  ];

  items.forEach(({ value, label }) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`;
    grid.appendChild(card);
  });
}

function slugFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // workers.cloudflare.com → cloudflare-workers
    // wisprflow.ai → wisprflow
    // linear.app → linear
    const parts = hostname.split('.');
    const tld = parts[parts.length - 1];
    const known = ['com','io','ai','app','dev','net','org','co','sh','gg','so','is','to'];
    const stripped = known.includes(tld) ? parts.slice(0, -1) : parts.slice(0, -1);
    // reverse so brand name comes first: workers.cloudflare → cloudflare-workers
    return stripped.reverse().join('-').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  } catch {
    return 'design-system';
  }
}

function stripHeader(md) {
  return md
    .replace(/^#[^\n]*\n/, '')           // remove title
    .replace(/^>[^\n]*\n/gm, '')          // remove > Extracted lines
    .replace(/^<!--[\s\S]*?-->\n?/gm, '') // remove <!-- comments -->
    .replace(/\n## Using This File[\s\S]*/, '') // remove trailing "Using This File" section
    .replace(/^\n+/, '')
    .trim();
}

function mergeMarkdown(design, structure, styles, url, slug) {
  const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const parts = [`# ${title} Design System\n> Extracted from ${url}\n`];
  if (design)    parts.push(`---\n\n${stripHeader(design)}`);
  if (structure) parts.push(`---\n\n${stripHeader(structure)}`);
  if (styles)    parts.push(`---\n\n${stripHeader(styles)}`);
  return parts.join('\n\n');
}

async function runExtraction() {
  showState('loading');
  setProgress(5, 'Connecting to page...');

  let tab;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
    if (!tab || !tab.id) throw new Error('No active tab found.');
  } catch (err) {
    showError('Could not access the active tab.');
    return;
  }

  // Set up message listener before triggering extraction
  const resultPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('Extraction timed out after 30 seconds.'));
    }, 30000);

    function handler(message) {
      if (message.type === 'EXTRACTION_PROGRESS') {
        setProgress(message.pct, message.msg);
      } else if (message.type === 'EXTRACTION_COMPLETE') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(handler);
        resolve(message);
      } else if (message.type === 'EXTRACTION_ERROR') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(handler);
        reject(new Error(message.error));
      }
    }
    chrome.runtime.onMessage.addListener(handler);
  });

  // Trigger extraction in service worker
  chrome.runtime.sendMessage({ type: 'EXTRACT', tabId: tab.id, tabUrl: tab.url });

  try {
    const result = await resultPromise;
    siteSlug = slugFromUrl(tab.url);
    combinedMarkdown = mergeMarkdown(
      result.markdown || '',
      result.structureMarkdown || '',
      result.stylesMarkdown || '',
      tab.url,
      siteSlug
    );

    // Update download button label with site slug
    const label = $('download-btn-label');
    if (label) label.textContent = `Download ${siteSlug}-design-system.md`;

    // Render framework badge
    const badge = $('framework-badge');
    badge.textContent = result.summary.framework || 'Custom Design System';

    renderStats(result.summary);
    showState('result');
  } catch (err) {
    showError(err.message);
  }
}

function showError(msg) {
  $('error-msg').textContent = msg;
  showState('error');
}

async function downloadMarkdown() {
  if (!combinedMarkdown) return;
  const blob = new Blob([combinedMarkdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${siteSlug}-design-system.md`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyToClipboard() {
  if (!combinedMarkdown) return;
  try {
    await navigator.clipboard.writeText(combinedMarkdown);
    const btn = $('copy-btn');
    btn.classList.add('copied');
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.5"/>
        <path d="M2 10V2h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg> Copy to Clipboard`;
    }, 2000);
  } catch {
    // Clipboard API may fail if popup loses focus
    showError('Clipboard write failed. Try downloading instead.');
  }
}

// Event bindings
$('extract-btn').addEventListener('click', runExtraction);
$('retry-btn').addEventListener('click', () => { showState('idle'); });
$('re-extract-btn').addEventListener('click', () => { combinedMarkdown = ''; siteSlug = 'design-system'; runExtraction(); });
$('download-btn').addEventListener('click', downloadMarkdown);
$('copy-btn').addEventListener('click', copyToClipboard);
