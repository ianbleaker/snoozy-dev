#!/usr/bin/env node
// Mockup kit renderer: wraps a mockup HTML fragment in one self-contained page
// styled with the project's own design tokens and stylesheets, so brainstorm
// visuals look like the real app. No dependencies — Node built-ins only.
// App-agnostic — copy into the project as <kit>/render.mjs and configure it
// through <kit>/kit.json (see project-patterns/mockup-kit.md).
//
// Usage (always from the project root):
//   node <kit>/render.mjs <fragment.html> --out <file.html> [--title <text>]
//
// kit.json (next to this script; every path relative to the project root):
//   {
//     "css":       ["src/styles/tokens.css", "src/styles/app.css"],  required, non-empty
//     "fonts":     ["https://fonts.googleapis.com/css2?family=..."], optional
//     "bodyClass": "app",                                          optional
//     "htmlAttrs": { "data-theme": "light" }                       optional
//   }
//
// Every css file is inlined in order into one <style>: relative @imports are
// inlined recursively (each file once), relative url() assets become data:
// URIs. http(s) url()s are left alone; http(s) @imports are hoisted to the
// top of the <style> (browsers ignore an @import below any rule). Artifact pages may load
// external stylesheets only from Google Fonts, hence the inlining.
//
// Helper classes for laying out options (mk- prefix, no colors of their own):
//   .mk-options  responsive grid of options (one column under 640px)
//   .mk-option   one option
//   .mk-label    the option's A/B/C label

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const MIME = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

const HELPER_CSS = `
/* mockup-kit helpers */
.mk-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; padding: 16px; }
.mk-option { min-width: 0; border: 1px dashed currentColor; border-radius: 8px; padding: 16px; }
.mk-label { display: inline-block; font-weight: 700; margin-bottom: 12px; opacity: 0.7; }
@media (max-width: 640px) { .mk-options { grid-template-columns: 1fr; } }
`;

function die(msg) {
  console.error(`mockup-kit: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.error(`mockup-kit: warning: ${msg}`);
}

function parseArgs(argv) {
  const opts = { fragment: null, out: null, title: 'Mockup' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--title') opts.title = argv[++i];
    else if (!opts.fragment) opts.fragment = a;
    else die(`unexpected argument: ${a}`);
  }
  if (!opts.fragment || !opts.out) {
    die('usage: node <kit>/render.mjs <fragment.html> --out <file.html> [--title <text>]');
  }
  return opts;
}

function loadKit() {
  const kitPath = fileURLToPath(new URL('./kit.json', import.meta.url));
  if (!fs.existsSync(kitPath)) die(`missing kit.json at ${kitPath}`);
  let kit;
  try {
    kit = JSON.parse(fs.readFileSync(kitPath, 'utf8'));
  } catch (err) {
    die(`invalid kit.json: ${err.message}`);
  }
  if (!kit || !Array.isArray(kit.css) || kit.css.length === 0) {
    die('kit.json "css" must be a non-empty array');
  }
  return kit;
}

const isExternal = (ref) => /^(data:|https?:|\/\/|#)/i.test(ref);

function inlineUrls(css, dir) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, ref) => {
    ref = ref.trim();
    if (isExternal(ref)) return match;
    const clean = ref.split(/[?#]/)[0];
    const file = path.resolve(dir, clean);
    const ext = path.extname(clean).slice(1).toLowerCase();
    const mime = MIME[ext];
    if (!mime) return match;
    if (!fs.existsSync(file)) {
      warn(`asset not found, left as-is: ${ref}`);
      return match;
    }
    if (fs.statSync(file).size > MAX_ASSET_BYTES) {
      warn(`asset over 2 MB, left as-is: ${ref}`);
      return match;
    }
    const b64 = fs.readFileSync(file).toString('base64');
    return `url("data:${mime};base64,${b64}")`;
  });
}

function inlineCss(file, seen, externalImports) {
  const abs = path.resolve(file);
  if (seen.has(abs)) return '';
  seen.add(abs);
  const dir = path.dirname(abs);
  let css = fs.readFileSync(abs, 'utf8');
  css = css.replace(
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/g,
    (match, _q1, urlRef, _q2, strRef) => {
      const ref = (urlRef || strRef).trim();
      if (isExternal(ref)) {
        // Browsers ignore an @import below any rule, so hoist it to the top.
        externalImports.push(match);
        return '';
      }
      const target = path.resolve(dir, ref);
      if (!fs.existsSync(target)) {
        warn(`@import not found, left as-is: ${ref}`);
        return match;
      }
      return inlineCss(target, seen, externalImports);
    },
  );
  return `/* ${path.relative(process.cwd(), abs)} */\n${inlineUrls(css, dir)}\n`;
}

const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.fragment)) die(`fragment not found: ${opts.fragment}`);
  const kit = loadKit();

  for (const f of kit.css) {
    if (!fs.existsSync(f)) die(`css file not found: ${f} (paths are relative to the project root)`);
  }
  const seen = new Set();
  const externalImports = [];
  const inlined = kit.css.map((f) => inlineCss(f, seen, externalImports)).join('\n');
  const css = [...new Set(externalImports)].join('\n') + '\n' + inlined;

  const fragment = fs.readFileSync(opts.fragment, 'utf8');
  const htmlAttrs = Object.entries(kit.htmlAttrs || {})
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
  const fonts = (kit.fonts || [])
    .map((href) => `<link rel="stylesheet" href="${escapeAttr(href)}">`)
    .join('\n');
  const bodyClass = kit.bodyClass ? ` class="${escapeAttr(kit.bodyClass)}"` : '';

  const page = `<!doctype html>
<html${htmlAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(opts.title)}</title>
${fonts}
<style>
${css}
${HELPER_CSS}
</style>
</head>
<body${bodyClass}>
${fragment}
</body>
</html>
`;

  const out = path.resolve(opts.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page);
  console.log(out);
}

main();
