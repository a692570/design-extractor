// Asset extraction — images, icons, SVGs from the page
// Runs inside the page context as part of the content script

export function extractAssets() {
  const images = [];
  const svgs = [];
  const icons = [];

  const seen = new Set();

  // ─── IMAGES (<img>, background-image, <picture>) ─────────────────────────

  document.querySelectorAll('img').forEach(el => {
    const src = el.currentSrc || el.src;
    if (!src || seen.has(src) || src.startsWith('data:')) return;
    seen.add(src);

    const r = el.getBoundingClientRect();
    images.push({
      src,
      alt: el.alt || '',
      width: el.naturalWidth || r.width,
      height: el.naturalHeight || r.height,
      visible: r.width > 0 && r.height > 0,
    });
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

  // ─── INLINE SVGs ────────────────────────────────────────────────────────

  document.querySelectorAll('svg').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;

    const html = el.outerHTML;
    const hash = html.length.toString(36) + html.slice(0, 40).replace(/\s+/g, '').length.toString(36);
    if (seen.has(`svg:${hash}`)) return;
    seen.add(`svg:${hash}`);

    const isIcon = r.width <= 48 && r.height <= 48;

    const entry = {
      html: el.outerHTML.length > 2000 ? el.outerHTML.slice(0, 2000) + '...' : el.outerHTML,
      width: Math.round(r.width),
      height: Math.round(r.height),
      viewBox: el.getAttribute('viewBox') || '',
      isIcon,
    };

    svgs.push(entry);
    if (isIcon) icons.push(entry);
  });

  // ─── FAVICON / APP ICONS ────────────────────────────────────────────────

  document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').forEach(el => {
    const href = el.href;
    if (!href || seen.has(href)) return;
    seen.add(href);
    const sizes = el.getAttribute('sizes') || '';
    icons.push({
      src: href,
      rel: el.rel,
      sizes,
      type: el.type || '',
    });
  });

  // ─── LOGO DETECTION ─────────────────────────────────────────────────────
  // Find the main logo in the header

  const logoCandidates = [];
  document.querySelectorAll('header a, [role="banner"] a, nav:first-of-type a').forEach(el => {
    const img = el.querySelector('img, svg');
    if (!img) return;
    const r = img.getBoundingClientRect();
    if (r.width < 20 || r.height < 10) return;
    if (r.width > 600) return;

    const isSvg = img.tagName === 'SVG';
    logoCandidates.push({
      tag: img.tagName.toLowerCase(),
      src: isSvg ? '' : (img.currentSrc || img.src || ''),
      svgHtml: isSvg ? img.outerHTML.slice(0, 3000) : '',
      width: Math.round(r.width),
      height: Math.round(r.height),
      alt: img.alt || '',
    });
  });

  return {
    images: images.slice(0, 50),
    svgs: svgs.slice(0, 30),
    icons: icons.slice(0, 30),
    logo: logoCandidates[0] || null,
  };
}
