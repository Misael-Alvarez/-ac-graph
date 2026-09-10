// Consolidates a stylesheet that grew by appending override layers.
//
//   node scripts/consolidate-css.mjs <in.css> <out.css> [--report]
//
// The stylesheet this was written for said the same selector in up to nine
// places, each later block overriding the one before. This merges every
// repeated selector into one rule, placed where its last occurrence was, with
// the declarations in cascade order and earlier duplicates of a property
// dropped. Repeated `@keyframes` keep only the last definition.
//
// Moving a declaration changes the cascade when a rule of the same specificity
// that sets the same property sits between where it was and where it goes. Each
// moved declaration is checked against every rule in between (including rules
// inside `@media` and `@supports`); when such a rule exists the declaration is
// left where it was, in a small residual rule, so the result is cascade-exact
// rather than merely probable. `:root` and `.dark` merge into their first
// occurrence instead, because the token blocks belong at the top and the test
// that keeps tokens.ts and the stylesheet in step reads them there.
//
// Comments are kept: the prose beside a rule travels with it; the banners of
// the old layers (lines of ═ and ──) are dropped, because the layers are gone.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';

const [, , inPath, outPath, ...flags] = process.argv;
if (!inPath || !outPath) {
  console.error(
    'usage: consolidate-css.mjs <in.css> <out.css> [--report] [--map <match-map.json>]',
  );
  process.exit(2);
}
const report = flags.includes('--report');
const mapArg = flags.indexOf('--map');
const root = postcss.parse(readFileSync(inPath, 'utf8'), { from: inPath });

/* ── Which selectors meet on a real element (from css-match-map.mjs) ─────── */

// selector -> Set of "state|path" element keys; absent = never seen rendered.
const matchMap = new Map();
if (mapArg >= 0) {
  const { map } = JSON.parse(readFileSync(flags[mapArg + 1], 'utf8'));
  for (const [selector, keys] of Object.entries(map)) matchMap.set(selector, new Set(keys));
}
const pseudoOf = (selector) =>
  selector.match(
    /::?(before|after|placeholder|selection|marker|backdrop|-webkit-[a-z-]+)\b/,
  )?.[1] ?? '';
const norm = (sel) => sel.replace(/\s+/g, ' ').trim();

/* ── Which classes can sit on one element (from the source and the tour) ─── */

// Every `className` expression in the source is a group of classes that can
// appear together on one element; so is every element the tour saw.
const classGroups = [];
const knownClasses = new Set();
let dynamicClassPrefixes = [];
const srcArg = flags.indexOf('--src');
if (srcArg >= 0) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\./.test(name)) files.push(full);
    }
  };
  walk(flags[srcArg + 1]);
  const prefixes = new Set();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{[^}]*\})/g)) {
      const body = m[1] ?? m[2] ?? m[0];
      const tokens = [...body.matchAll(/(?<![\w$-])([a-z][a-z0-9-]*)(?![\w-])/g)].map((t) => t[1]);
      const group = tokens.filter((t) => t.includes('-') || t.length > 2);
      for (const t of group) knownClasses.add(t);
      if (group.length) classGroups.push(new Set(group));
      // `is-${x}` and the like: any class with that prefix may exist.
      for (const d of body.matchAll(/([a-z][a-z0-9-]*-)\$\{/g)) prefixes.add(d[1]);
    }
    // Classes given by hand: `el.className = 'tooltip'`, `classList.add('ripple', …)`.
    for (const m of text.matchAll(/\.className\s*=\s*['"`]([^'"`]*)['"`]/g)) {
      const tokens = m[1].split(/\s+/).filter(Boolean);
      for (const t of tokens) knownClasses.add(t);
      if (tokens.length) classGroups.push(new Set(tokens));
    }
    for (const m of text.matchAll(/classList\.(?:add|toggle|remove)\(([^)]*)\)/g)) {
      for (const t of m[1].matchAll(/['"]([a-z][a-z0-9-]*)['"]/g)) knownClasses.add(t[1]);
    }
  }
  dynamicClassPrefixes = [...prefixes];
}
for (const keys of matchMap.values()) {
  for (const key of keys) {
    const last = key.split('>').at(-1) ?? '';
    const classes = last
      .split('.')
      .slice(1)
      .map((c) => c.replace(/:\d+$/, ''));
    if (classes.length) classGroups.push(new Set(classes));
  }
}
const classKnown = (c) => knownClasses.has(c) || dynamicClassPrefixes.some((p) => c.startsWith(p));

/** The last compound of a selector: the element the rule styles. */
function subject(selector) {
  const withoutPseudo = selector
    .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
    .replace(/\[[^\]]*\]/g, '');
  const compound =
    withoutPseudo
      .split(/\s*[\s>+~]\s*/)
      .filter(Boolean)
      .at(-1) ?? '';
  const classes = [...compound.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  const tag = compound.match(/^[a-zA-Z][a-zA-Z0-9-]*/)?.[0]?.toLowerCase() ?? null;
  return { classes, tag, universal: compound.startsWith('*') || compound === '' };
}

/**
 * Whether two selectors can apply to the same box.
 *
 * Known when both were seen rendered somewhere in the tour: they meet if their
 * element sets intersect. When either was never seen rendered, the question is
 * answered statically from their subjects: two different tags never meet; two
 * class sets meet only if some element in the source or the tour carries both.
 * A subject with no class and no tag meets anything.
 */
function coMatch(a, b) {
  if (pseudoOf(a) !== pseudoOf(b)) return false;
  const sa = matchMap.get(norm(a));
  const sb = matchMap.get(norm(b));
  if (sa && sb) {
    const [small, large] = sa.size < sb.size ? [sa, sb] : [sb, sa];
    for (const key of small) if (large.has(key)) return true;
    return false;
  }
  const A = subject(a);
  const B = subject(b);
  if (A.tag && B.tag && A.tag !== B.tag) return false;
  const needed = [...new Set([...A.classes, ...B.classes])];
  if (!needed.length) return true;
  if (!A.classes.length && !B.tag && !B.universal) return true;
  if (!B.classes.length && !A.tag && !A.universal) return true;
  return classGroups.some((group) => needed.every((c) => group.has(c)));
}

/* ── Specificity ─────────────────────────────────────────────────────────── */

/** (ids, classes/attrs/pseudo-classes, elements/pseudo-elements) of one selector. */
function specificity(selector) {
  let s = selector
    // :not(), :is(), :where() take the specificity of their argument (or none).
    .replace(/:where\([^)]*\)/g, '')
    .replace(/:(not|is|has)\(([^)]*)\)/g, (_, __, inner) => inner.split(',')[0]);
  let ids = 0;
  let classes = 0;
  let elements = 0;
  s = s.replace(/\[[^\]]*\]/g, () => (classes++, ''));
  s = s.replace(/::[a-zA-Z-]+(\([^)]*\))?/g, () => (elements++, ''));
  s = s.replace(/:[a-zA-Z-]+(\([^)]*\))?/g, () => (classes++, ''));
  s = s.replace(/#[a-zA-Z0-9_-]+/g, () => (ids++, ''));
  s = s.replace(/\.[a-zA-Z0-9_-]+/g, () => (classes++, ''));
  s = s.replace(/[>+~*\s]/g, ' ');
  for (const token of s.split(' ')) if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(token)) elements++;
  return `${ids},${classes},${elements}`;
}

/* ── Flatten into an ordered list of "sites" ─────────────────────────────── */

const normaliseSelector = (sel) =>
  sel
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .trim();
const contextOf = (node) => {
  const parts = [];
  let p = node.parent;
  while (p && p.type === 'atrule') {
    parts.unshift(`@${p.name} ${p.params}`);
    p = p.parent;
  }
  return parts.join(' / ');
};

// Top-level nodes and at-rule children, in document order, with a position.
const sites = [];
let position = 0;
const walkChildren = (container) => {
  for (const node of container.nodes ?? []) {
    if (node.type === 'rule') {
      sites.push({ node, position: position++, context: contextOf(node) });
    } else if (node.type === 'atrule' && ['media', 'supports', 'container'].includes(node.name)) {
      walkChildren(node);
    } else if (node.type === 'atrule') {
      sites.push({ node, position: position++, context: contextOf(node) });
    }
  }
};
walkChildren(root);

const isBanner = (comment) => /[═─]{6,}/.test(comment.text);
const precedingComments = (node) => {
  const out = [];
  let prev = node.prev();
  while (prev && prev.type === 'comment') {
    out.unshift(prev);
    prev = prev.prev();
  }
  return out;
};

/* ── Dead rules: classes that appear nowhere in the source or the tour ──── */

const prune = flags.includes('--prune-dead');
const deadLog = [];
function isDead(selectorList) {
  if (!knownClasses.size) return false;
  return selectorList.split(',').every((sel) => {
    const classes = [...sel.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
    return classes.length > 0 && classes.some((c) => !classKnown(c)) && !matchMap.has(norm(sel));
  });
}

/* ── Group rules by (context, selector) ─────────────────────────────────── */

const groups = new Map(); // key -> [{site, decls: Declaration[], comments}]
for (const site of sites) {
  if (site.node.type !== 'rule') continue;
  if (isDead(site.node.selector)) {
    deadLog.push(
      `${site.node.selector.replace(/\s+/g, ' ')}${site.context ? `  (${site.context})` : ''}`,
    );
    if (prune) {
      site.dead = true;
      continue;
    }
  }
  const key = `${site.context} :: ${normaliseSelector(site.node.selector)}`;
  const decls = site.node.nodes.filter((n) => n.type === 'decl');
  const nested = site.node.nodes.filter((n) => n.type !== 'decl' && n.type !== 'comment');
  if (nested.length) {
    // A rule with nested rules or at-rules is left exactly as it is.
    site.keep = true;
    continue;
  }
  if (!groups.has(key)) groups.set(key, []);
  groups
    .get(key)
    .push({ site, decls, comments: precedingComments(site.node).filter((c) => !isBanner(c)) });
}

/* ── Properties that reach the same values ───────────────────────────────── */

/**
 * The family a property belongs to, for the purpose of "does setting this
 * disturb that": a shorthand and its longhands are one family, and so are two
 * longhands of the same shorthand. Coarse on purpose — `border-radius` sits in
 * the `border` family though `border` does not reset it — because a false
 * positive only costs a residual, while a false negative changes a screen.
 */
function family(prop) {
  const p =
    prop.startsWith('-webkit-') || prop.startsWith('-moz-')
      ? prop.replace(/^-(webkit|moz)-/, '')
      : prop;
  if (p.startsWith('--')) return p;
  if (['top', 'right', 'bottom', 'left', 'inset'].includes(p) || p.startsWith('inset-'))
    return 'inset';
  if (p === 'line-height' || p.startsWith('font')) return 'font';
  if (p.endsWith('gap')) return 'gap';
  if (/^(place|align|justify)-/.test(p)) return 'place';
  if (/^(grid|grid-)/.test(p)) return 'grid';
  if (p.startsWith('flex')) return 'flex';
  if (p.startsWith('overflow')) return 'overflow';
  if (p.startsWith('border')) return 'border';
  if (p.startsWith('outline')) return 'outline';
  if (p.startsWith('background')) return 'background';
  if (p.startsWith('padding')) return 'padding';
  if (p.startsWith('margin')) return 'margin';
  if (p.startsWith('transition')) return 'transition';
  if (p.startsWith('animation')) return 'animation';
  if (p.startsWith('text-decoration')) return 'text-decoration';
  if (p.startsWith('mask')) return 'mask';
  if (p.startsWith('scroll-')) return p.split('-').slice(0, 2).join('-');
  if (p === 'transform' || p === 'translate' || p === 'scale' || p === 'rotate') return p;
  return p;
}

// Where a property family is set by any rule, for the conflict check.
const settersByProp = new Map(); // family -> [{position, selectors:[{text,spec}], key, important}]
const parts = (selectorList) =>
  selectorList.split(',').map((s) => ({ text: norm(s), spec: specificity(norm(s)) }));
for (const site of sites) {
  if (site.node.type !== 'rule' || site.dead) continue;
  const selectors = parts(site.node.selector);
  const key = `${site.context} :: ${normaliseSelector(site.node.selector)}`;
  for (const d of site.node.nodes) {
    if (d.type !== 'decl') continue;
    const fam = family(d.prop);
    if (!settersByProp.has(fam)) settersByProp.set(fam, []);
    settersByProp
      .get(fam)
      .push({ position: site.position, selectors, key, important: !!d.important });
  }
}

/**
 * Whether moving `prop` of rule `key` from `from` to `to` crosses a rule that
 * competes for it: same property, same importance, a selector of the same
 * specificity, and the two selectors meet on an element. Only then does order
 * decide the winner, and only then must the declaration stay put.
 */
function conflicts(key, prop, from, to, selectors, important) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return (settersByProp.get(family(prop)) ?? []).find(
    (r) =>
      r.key !== key &&
      r.position > lo &&
      r.position < hi &&
      r.important === important &&
      selectors.some((a) => r.selectors.some((b) => a.spec === b.spec && coMatch(a.text, b.text))),
  );
}

const FIRST_ANCHORED = new Set([':root', '.dark']);

/* ── Decide the merged rule for each group ──────────────────────────────── */

const emitAt = new Map(); // position -> array of {kind:'rule'|'residual'|'keep', ...}
const push = (pos, item) => {
  if (!emitAt.has(pos)) emitAt.set(pos, []);
  emitAt.get(pos).push(item);
};

let merged = 0;
let residuals = 0;
let droppedDecls = 0;
const residualLog = [];

for (const [key, occurrences] of groups) {
  const selector = occurrences[0].site.node.selector;
  const selectorParts = parts(selector);
  const anchorFirst =
    FIRST_ANCHORED.has(normaliseSelector(selector)) && !occurrences[0].site.context;
  const target = anchorFirst ? occurrences[0].site.position : occurrences.at(-1).site.position;

  if (occurrences.length === 1) {
    push(target, {
      kind: 'rule',
      selector,
      decls: occurrences[0].decls,
      comments: occurrences[0].comments,
      context: occurrences[0].site.context,
    });
    continue;
  }
  merged += occurrences.length - 1;

  // Cascade order of all declarations, then keep the last of each property
  // (respecting !important: an important declaration is only replaced by a
  // later important one).
  const ordered = occurrences.flatMap((o) => o.decls.map((d) => ({ d, from: o.site.position })));
  const lastIndexByProp = new Map();
  ordered.forEach(({ d }, i) => {
    const prev = lastIndexByProp.get(d.prop);
    if (prev === undefined || !ordered[prev].d.important || d.important)
      lastIndexByProp.set(d.prop, i);
  });
  const kept = [];
  ordered.forEach((entry, i) => {
    if (lastIndexByProp.get(entry.d.prop) === i) kept.push(entry);
    else droppedDecls++;
  });

  const mergedDecls = [];
  const residualByPos = new Map();
  for (const { d, from } of kept) {
    const clash =
      from !== target && conflicts(key, d.prop, from, target, selectorParts, !!d.important);
    if (clash) {
      if (!residualByPos.has(from)) residualByPos.set(from, { decls: [], against: new Set() });
      residualByPos.get(from).decls.push(d);
      residualByPos.get(from).against.add(clash.key.replace(/^ :: /, '').replace(/,/g, ', '));
      residuals++;
      residualLog.push(
        `${selector.replace(/\s+/g, ' ')} { ${d.prop} } stays at #${from} (target #${target}) — meets ${clash.key.replace(/^ :: /, '')} at #${clash.position}`,
      );
    } else {
      mergedDecls.push(d);
    }
  }
  const comments = [];
  const seen = new Set();
  for (const o of occurrences)
    for (const c of o.comments)
      if (!seen.has(c.text)) {
        seen.add(c.text);
        comments.push(c);
      }

  push(target, {
    kind: 'rule',
    selector,
    decls: mergedDecls,
    comments,
    context: occurrences.at(-1).site.context,
  });
  for (const [pos, { decls, against }] of residualByPos) {
    const why = postcss.comment({
      text: `Cascade-pinned: must stay before ${[...against].join(' and ')}; the rest of this selector is further down.`,
    });
    push(pos, {
      kind: 'rule',
      selector,
      decls,
      comments: [why],
      context: occurrences.find((o) => o.site.position === pos).site.context,
      residual: true,
    });
  }
}

// Keyframes: last definition wins; other at-rules kept in place.
const keyframesLast = new Map();
for (const site of sites) {
  if (site.node.type === 'atrule' && site.node.name === 'keyframes')
    keyframesLast.set(site.node.params, site.position);
}
for (const site of sites) {
  if (site.node.type === 'atrule') {
    // The @import is emitted first, by hand.
    if (site.node.name === 'import') continue;
    if (site.node.name === 'keyframes' && keyframesLast.get(site.node.params) !== site.position)
      continue;
    push(site.position, {
      kind: 'keep',
      node: site.node,
      comments: precedingComments(site.node).filter((c) => !isBanner(c)),
    });
  } else if (site.keep) {
    push(site.position, {
      kind: 'keep',
      node: site.node,
      comments: precedingComments(site.node).filter((c) => !isBanner(c)),
    });
  }
}

/* ── Emit, rebuilding the at-rule wrappers around consecutive same-context rules ── */

const header = `/*
  The stylesheet, in cascade order.

  Tokens first (\`:root\`, \`.dark\`, the tones), then the rules. This file was
  consolidated from a stylesheet that had grown by appending override layers
  (scripts/consolidate-css.mjs, verified property-for-property against the
  running product with scripts/style-snapshot.mjs). Each selector appears once,
  except where a declaration has to sit before another rule of equal
  specificity for the cascade to come out the same; those few are marked
  "Cascade-pinned". When a rule needs to change, change it where it is; do not
  append an override at the end.

  tokens.test.ts keeps \`:root\` and \`.dark\` in step with src/lib/design/tokens.ts.
*/
`;

const out = postcss.root();
out.append(postcss.parse(header));
// Non-rule, non-at-rule top-level nodes (the @import) come first, in order.
for (const node of root.nodes) {
  if (node.type === 'atrule' && node.name === 'import') out.append(node.clone());
}

const positions = [...emitAt.keys()].sort((a, b) => a - b);
let currentWrapper = null; // { context, node }
const wrapperFor = (context) => {
  if (!context) return out;
  if (currentWrapper && currentWrapper.context === context) return currentWrapper.node;
  // Build nested at-rules from the context string.
  const parts = context.split(' / ');
  let container = out;
  for (const part of parts) {
    const [, name, params] = part.match(/^@([a-z-]+)\s*(.*)$/);
    const at = postcss.atRule({ name, params });
    container.append(at);
    container = at;
  }
  currentWrapper = { context, node: container };
  return container;
};

for (const pos of positions) {
  for (const item of emitAt.get(pos)) {
    if (item.kind === 'keep') {
      const ctx = contextOf(item.node);
      const target = wrapperFor(ctx);
      for (const c of item.comments) target.append(c.clone());
      target.append(item.node.clone());
      if (!ctx) currentWrapper = null;
      continue;
    }
    if (!item.decls.length) continue;
    const target = wrapperFor(item.context);
    for (const c of item.comments) target.append(c.clone());
    const rule = postcss.rule({ selector: item.selector });
    for (const d of item.decls) rule.append(d.clone());
    target.append(rule);
    if (!item.context) currentWrapper = null;
  }
}

writeFileSync(outPath, out.toString());

const before = readFileSync(inPath, 'utf8').split('\n').length;
const after = out.toString().split('\n').length;
console.log(
  `rules merged: ${merged} · declarations dropped as overridden: ${droppedDecls} · residual declarations kept in place: ${residuals}`,
);
console.log(`lines: ${before} → ${after} (before formatting)`);
if (report && residualLog.length) {
  console.log('\nResiduals (cascade-sensitive declarations left where they were):');
  for (const line of residualLog) console.log('  ' + line);
}
if (deadLog.length) {
  console.log(
    `\n${prune ? 'Pruned' : 'Dead (pass --prune-dead to remove)'}: ${deadLog.length} rule(s) whose classes appear nowhere in the source or the tour`,
  );
  if (report) for (const line of deadLog) console.log('  ' + line);
}
