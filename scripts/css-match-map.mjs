// Which elements each selector of a stylesheet actually matches, across the
// product's states.
//
//   node scripts/css-match-map.mjs <stylesheet.css> <out.json> [baseUrl]
//
// The consolidator needs to know whether two rules can ever apply to the same
// element; the stylesheet alone cannot say (an element may or may not carry
// both classes). This asks the running product: every selector is evaluated in
// every state of the tour, with hover/focus pseudo-classes stripped so that a
// hover rule is matched against the elements it would hover, and the matched
// elements are recorded by state and structural path. Pseudo-elements are kept
// as a namespace: `.x::before` meets `.y::before`, never `.y`.
import { readFileSync, writeFileSync } from 'node:fs';
import postcss from 'postcss';
import { chromium } from '@playwright/test';
import { tour } from './lib/tour.mjs';

const [, , cssPath, outPath, base = 'http://127.0.0.1:3100'] = process.argv;
if (!cssPath || !outPath) {
  console.error('usage: css-match-map.mjs <stylesheet.css> <out.json> [baseUrl]');
  process.exit(2);
}

const root = postcss.parse(readFileSync(cssPath, 'utf8'));
const selectors = new Set();
root.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return;
  for (const s of rule.selector.split(',')) selectors.add(s.replace(/\s+/g, ' ').trim());
});
const list = [...selectors];

/** The selector as the DOM can evaluate it, and the pseudo-element it addresses. */
export function evaluable(selector) {
  const pseudo =
    selector.match(/::?(before|after|placeholder|selection|marker|backdrop)\b/)?.[1] ?? '';
  const dynamic = 'focus-visible|focus-within|hover|active|focus|target|visited|link';
  let s = selector
    .replace(/::?(before|after|placeholder|selection|marker|backdrop|-webkit-[a-z-]+)\b/g, '')
    // `:not(:focus)` and friends: the element may or may not be in that state,
    // so the rule may apply — drop the whole negation and match more.
    .replace(new RegExp(`:not\\(:(${dynamic})\\)`, 'g'), '')
    .replace(new RegExp(`:(${dynamic})\\b`, 'g'), '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || /[>+~]$/.test(s)) s = s.replace(/[>+~]\s*$/, '').trim() || '*';
  return { query: s, pseudo };
}

const browser = await chromium.launch();
const map = {}; // selector -> [elementKey]
const unknown = new Set();

await tour(browser, base, async (name, page, rootSel) => {
  const results = await page.evaluate(
    ([sels, rootSelector]) => {
      const pathOf = (el) => {
        const parts = [];
        let node = el;
        while (node && node !== document.body && node.nodeType === 1) {
          const parent = node.parentElement;
          const siblings = parent
            ? [...parent.children].filter((c) => c.tagName === node.tagName)
            : [node];
          const index = siblings.indexOf(node);
          const classes = [...node.classList].sort().join('.');
          parts.unshift(
            `${node.tagName.toLowerCase()}${classes ? '.' + classes : ''}${siblings.length > 1 ? `:${index}` : ''}`,
          );
          node = parent;
        }
        return parts.join('>');
      };
      // The whole document, whatever panel the state is about: two rules meet
      // on an element wherever that element is.
      void rootSelector;
      const inScope = () => true;
      const out = {};
      const bad = [];
      for (const [query, original] of sels) {
        let matched;
        try {
          matched = document.querySelectorAll(query);
        } catch {
          bad.push(original);
          continue;
        }
        const keys = [];
        for (const el of matched) {
          if (!inScope(el) || el.closest('defs, symbol')) continue;
          keys.push(
            el === document.documentElement ? 'html' : el === document.body ? 'body' : pathOf(el),
          );
        }
        if (keys.length) out[original] = keys;
      }
      return { out, bad };
    },
    [list.map((s) => [evaluable(s).query, s]), rootSel],
  );
  for (const s of results.bad) unknown.add(s);
  let hits = 0;
  for (const [selector, keys] of Object.entries(results.out)) {
    if (!map[selector]) map[selector] = [];
    for (const k of keys) map[selector].push(`${name}|${k}`);
    hits += keys.length;
  }
  process.stdout.write(`  ${name}: ${hits} matches\n`);
});

await browser.close();
writeFileSync(outPath, JSON.stringify({ map, unknown: [...unknown] }));
const matched = Object.keys(map).length;
console.log(
  `\n${matched}/${list.length} selectors matched something in some state; ${unknown.size} could not be evaluated; ${list.length - matched - unknown.size} matched nothing`,
);
