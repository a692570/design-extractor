// Recursive var() chain resolver — ported from insane-design's var_resolver.py
// Resolves CSS custom property chains to terminal values (hex, rgba, etc.)
// With cycle detection and fallback handling.

const TERMINAL_PATTERNS = [
  /^#[0-9a-fA-F]{3,8}$/,
  /^(rgb|hsl|oklch|lch|lab|oklab|color)\s*\(/i,
  /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|vh|vw|%|deg|s|ms|fr|ch|ex|cm|mm|in|pt|pc)?$/,
];

function isTerminalValue(value) {
  const stripped = value.trim();
  if (!stripped) return false;
  return TERMINAL_PATTERNS.some(p => p.test(stripped));
}

function unwrapVarCall(value) {
  const stripped = value.trim();
  if (!stripped.startsWith('var(') || !stripped.endsWith(')')) return null;

  let depth = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0 && i !== stripped.length - 1) return null;
    }
  }
  if (depth !== 0) return null;
  return stripped.slice(4, -1).trim();
}

function splitVarArguments(inner) {
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') { if (depth > 0) depth--; }
    else if (ch === ',' && depth === 0) {
      const ref = inner.slice(0, i).trim();
      const fallback = inner.slice(i + 1).trim() || null;
      return [ref, fallback];
    }
  }
  return [inner.trim(), null];
}

function normalizeName(name) {
  return name.startsWith('--') ? name : `--${name}`;
}

function resolveValue(value, props, seen) {
  const stripped = value.trim();

  if (isTerminalValue(stripped)) {
    return { terminal: stripped, chain: [stripped] };
  }

  const inner = unwrapVarCall(stripped);
  if (inner === null) {
    return { terminal: null, chain: [stripped] };
  }

  const [reference, fallback] = splitVarArguments(inner);
  const normalized = normalizeName(reference);

  if (normalized in props) {
    const result = resolveVarWithChain(normalized, props, seen);
    return result;
  }

  if (fallback === null) {
    return { terminal: null, chain: [normalized] };
  }

  const fallbackResult = resolveValue(fallback, props, seen);
  return {
    terminal: fallbackResult.terminal,
    chain: prependChain(normalized, fallbackResult.chain),
  };
}

function prependChain(head, tail) {
  if (tail.length && tail[0] === head) return [head, ...tail.slice(1)];
  return [head, ...tail];
}

function resolveVarWithChain(name, props, seen) {
  const normalized = normalizeName(name);
  const active = seen ? new Set(seen) : new Set();

  if (active.has(normalized)) {
    return { terminal: null, chain: [normalized] };
  }

  const raw = props[normalized];
  if (raw === undefined || raw === null) {
    return { terminal: null, chain: [normalized] };
  }

  active.add(normalized);
  const result = resolveValue(raw, props, active);
  return {
    terminal: result.terminal,
    chain: prependChain(normalized, result.chain),
  };
}

export function resolveVar(name, props, seen) {
  return resolveVarWithChain(name, props, seen).terminal;
}

export function resolveAll(props) {
  const resolved = {};
  let resolvedCount = 0;

  for (const [name, raw] of Object.entries(props)) {
    const { terminal, chain } = resolveVarWithChain(name, props);
    resolved[name] = {
      raw,
      resolvedTerminal: terminal,
      chain,
    };
    if (terminal !== null) resolvedCount++;
  }

  return {
    totalVars: Object.keys(props).length,
    resolvedCount,
    unresolvedCount: Object.keys(props).length - resolvedCount,
    vars: resolved,
  };
}

export function resolveCssVarsMap(cssVarsMap) {
  const flatProps = {};
  for (const [name, data] of Object.entries(cssVarsMap)) {
    flatProps[name] = typeof data === 'object' && data.rawValue ? data.rawValue : (typeof data === 'string' ? data : data.value || '');
  }
  return resolveAll(flatProps);
}
