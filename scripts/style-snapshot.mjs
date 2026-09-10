// Computed-style snapshot of the product's states, for comparing a stylesheet
// change with property precision rather than pixel precision.
//
//   node scripts/style-snapshot.mjs capture <out.json> [baseUrl]
//   node scripts/style-snapshot.mjs compare <before.json> <after.json>
//
// Every element in every state is keyed by its structural path (tag, classes,
// index among siblings — never by generated ids) and recorded as the values of
// a fixed list of computed properties. Hover states are captured for a set of
// controls, and the editor is captured at three widths so the media queries
// are covered. A comparison lists each element whose properties changed.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { tour } from './lib/tour.mjs';

const PROPS = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'overflow-x',
  'overflow-y',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-style',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'background-color',
  'background-image',
  'background-position',
  'background-size',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-transform',
  'text-align',
  'white-space',
  'text-overflow',
  'text-decoration-line',
  'opacity',
  'visibility',
  'pointer-events',
  'cursor',
  'box-shadow',
  'outline-style',
  'outline-color',
  'outline-width',
  'transform',
  'transform-origin',
  'translate',
  'scale',
  'transition-property',
  'transition-duration',
  'transition-timing-function',
  'animation-name',
  'animation-duration',
  'animation-timing-function',
  'animation-delay',
  'backdrop-filter',
  'filter',
  'gap',
  'row-gap',
  'column-gap',
  'align-items',
  'justify-content',
  'flex-direction',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'grid-template-columns',
  'inset',
  'isolation',
  'mix-blend-mode',
  'object-fit',
  'font-variant-numeric',
  'text-wrap-style',
  'fill',
  'stroke',
  'stroke-width',
];

const [, , mode, ...rest] = process.argv;

// Text that changes with every build — the build stamp — changes the width of
// the element that shows it; that is not a style difference.
const VOLATILE = /library-footer|topbar-menu-stamp/;

if (mode === 'compare') {
  const [beforePath, afterPath] = rest;
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  let differing = 0;
  let elements = 0;
  for (const state of Object.keys(before)) {
    const a = before[state];
    const b = after[state] ?? {};
    const paths = new Set([...Object.keys(a), ...Object.keys(b)]);
    const stateDiffs = [];
    for (const path of paths) {
      if (VOLATILE.test(path)) continue;
      elements++;
      if (!(path in a) || !(path in b)) {
        stateDiffs.push(`  ${path}\n      ${path in a ? 'missing after' : 'new after'}`);
        continue;
      }
      if (a[path] === b[path]) continue;
      const av = a[path].split('\u001f');
      const bv = b[path].split('\u001f');
      const changed = PROPS.map((p, i) =>
        av[i] !== bv[i] ? `${p}: ${av[i]}  →  ${bv[i]}` : null,
      ).filter(Boolean);
      stateDiffs.push(`  ${path}\n      ${changed.join('\n      ')}`);
    }
    if (stateDiffs.length) {
      differing += stateDiffs.length;
      console.log(`\n■ ${state}: ${stateDiffs.length} element(s) differ`);
      console.log(stateDiffs.slice(0, 40).join('\n'));
      if (stateDiffs.length > 40) console.log(`  … and ${stateDiffs.length - 40} more`);
    }
  }
  console.log(
    `\n${differing} differing element(s) across ${elements} compared${differing ? '' : ' — identical'}`,
  );
  process.exit(differing ? 1 : 0);
}

if (mode !== 'capture') {
  console.error(
    'usage: style-snapshot.mjs capture <out.json> [baseUrl] | compare <a.json> <b.json>',
  );
  process.exit(2);
}

const [outPath, base = 'http://127.0.0.1:3100'] = rest;
const browser = await chromium.launch();
const out = {};

const snapshot = (page, root = 'body') =>
  page.evaluate(
    ([props, rootSel]) => {
      const rootEl = document.querySelector(rootSel);
      if (!rootEl) return {};
      const pathOf = (el) => {
        const parts = [];
        let node = el;
        while (node && node !== document.body && node.nodeType === 1) {
          const parent = node.parentElement;
          const siblings = parent
            ? [...parent.children].filter((c) => c.tagName === node.tagName)
            : [node];
          const index = siblings.indexOf(node);
          const classes = [...node.classList]
            .filter((c) => !/^is-(active|current|selected)$/.test(c) || true)
            .sort()
            .join('.');
          parts.unshift(
            `${node.tagName.toLowerCase()}${classes ? '.' + classes : ''}${siblings.length > 1 ? `:${index}` : ''}`,
          );
          node = parent;
        }
        return parts.join('>');
      };
      const result = {};
      const all = rootEl.matches('body')
        ? rootEl.querySelectorAll('*')
        : [rootEl, ...rootEl.querySelectorAll('*')];
      for (const el of all) {
        // The icon sprite is a copy of a static file; skip its thousands of nodes.
        if (el.closest('defs, symbol')) continue;
        const cs = getComputedStyle(el);
        // Generated ids inside url(#…) references change between sessions;
        // the reference is the same reference whatever the id says.
        result[pathOf(el)] = props
          .map((p) => cs.getPropertyValue(p).replace(/url\("#[^"]+"\)/g, 'url(#id)'))
          .join('\u001f');
      }
      return result;
    },
    [PROPS, root],
  );

await tour(browser, base, async (name, page, rootSel) => {
  out[name] = await snapshot(page, rootSel);
  process.stdout.write(`  ${name}: ${Object.keys(out[name]).length} elements\n`);
});

writeFileSync(outPath, JSON.stringify(out));
const states = Object.keys(out).length;
const elements = Object.values(out).reduce((n, s) => n + Object.keys(s).length, 0);
console.log(`\nwrote ${outPath}: ${states} states, ${elements} elements`);
await browser.close();
