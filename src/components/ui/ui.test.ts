// @vitest-environment happy-dom
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Chip, ChipRow } from './Chip';
import { Field, NumberField } from './Field';
import { GroupHeader } from './GroupHeader';
import { Kbd } from './Kbd';
import { Row } from './Row';
import { SearchField } from './SearchField';
import { Section } from './Section';
import { SpriteIcon, Tile } from './Tile';

/**
 * Each system component must render exactly the markup it replaced: the
 * stylesheet dresses these classes, the tests select by them, and the style
 * snapshot keys every element by tag, class set and position. So every test
 * here renders the component next to the hand-written element it stands in
 * for and compares the HTML byte for byte.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function html(node: ReactNode): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  const out = host.innerHTML;
  act(() => root.unmount());
  host.remove();
  return out;
}

const noop = () => {};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Kbd', () => {
  it('is a bare kbd, with a class only when asked', () => {
    expect(html(h(Kbd, { children: '⌘K' }))).toBe('<kbd>⌘K</kbd>');
    expect(html(h(Kbd, { className: 'palette-meta', children: '⌘S' }))).toBe(
      '<kbd class="palette-meta">⌘S</kbd>',
    );
  });
});

describe('SearchField', () => {
  it('renders the browser search exactly', () => {
    const component = html(
      h(SearchField, {
        className: 'browser-search',
        inputClassName: 'browser-search-input',
        placeholder: 'Search',
        value: 'ec2',
        onChange: noop,
        trailing: h('button', { type: 'button', className: 'icon-button' }, 'x'),
      }),
    );
    const handWritten = html(
      h(
        'div',
        { className: 'browser-search filter-field' },
        h('svg', { width: 14, height: 14, viewBox: '0 0 24 24' }),
        h('input', {
          className: 'browser-search-input filter-input',
          placeholder: 'Search',
          value: 'ec2',
          onChange: noop,
        }),
        h('button', { type: 'button', className: 'icon-button' }, 'x'),
      ),
    );
    // The icon is the shared SearchIcon; compare everything around it.
    const strip = (s: string) => s.replace(/<svg[\s\S]*?<\/svg>/, '<svg/>');
    expect(strip(component)).toBe(strip(handWritten));
    expect(component).toContain('width="14" height="14"');
  });

  it('takes the icon size and the input ref the picker and the library need', () => {
    expect(
      html(
        h(SearchField, {
          className: 'library-search',
          inputClassName: 'library-search-input',
          iconSize: 15,
          placeholder: 'p',
          value: '',
          onChange: noop,
        }),
      ),
    ).toContain('width="15" height="15"');
  });
});

describe('Chip and ChipRow', () => {
  it('renders a cloud tab exactly', () => {
    const component = html(
      h(Chip, {
        role: 'tab',
        className: 'browser-cloud',
        active: true,
        title: 'Amazon Web Services',
        color: '#f90',
        dotClassName: 'browser-cloud-dot',
        count: 127,
        countClassName: 'browser-cloud-count',
        onClick: noop,
        children: 'AWS',
      }),
    );
    expect(component).toBe(
      html(
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': true,
            className: 'browser-cloud chip is-active',
            title: 'Amazon Web Services',
            style: { '--cloud-color': '#f90' },
            onClick: noop,
          },
          h('span', { className: 'browser-cloud-dot chip-dot' }),
          'AWS',
          h('span', { className: 'browser-cloud-count chip-count' }, 127),
        ),
      ),
    );
  });

  it('renders the "mine" tab, without a colour, and a plain library folder chip', () => {
    expect(
      html(
        h(Chip, {
          role: 'tab',
          className: 'icon-picker-cloud',
          modifier: 'is-mine',
          active: false,
          title: 'Mine',
          dotClassName: 'icon-picker-cloud-dot',
          count: 2,
          countClassName: 'icon-picker-cloud-count',
          onClick: noop,
          children: 'Mine',
        }),
      ),
    ).toBe(
      '<button type="button" role="tab" aria-selected="false" class="icon-picker-cloud chip is-mine" title="Mine"><span class="icon-picker-cloud-dot chip-dot"></span>Mine<span class="icon-picker-cloud-count chip-count">2</span></button>',
    );
    expect(
      html(
        h(Chip, {
          className: 'library-folder',
          active: true,
          count: 3,
          onClick: noop,
          children: 'All',
        }),
      ),
    ).toBe(
      '<button type="button" class="library-folder chip is-active">All<span class="chip-count">3</span></button>',
    );
  });

  it('renders a tab list and a plain row', () => {
    expect(
      html(h(ChipRow, { className: 'browser-clouds', tabs: true, label: 'Clouds', children: 'x' })),
    ).toBe('<div class="browser-clouds chip-row" role="tablist" aria-label="Clouds">x</div>');
    expect(html(h(ChipRow, { className: 'library-folders', children: 'x' }))).toBe(
      '<div class="library-folders chip-row">x</div>',
    );
  });
});

describe('GroupHeader', () => {
  it('folds as a button with a chevron before the name', () => {
    expect(
      html(
        h(GroupHeader, {
          className: 'browser-section-header',
          open: false,
          onToggle: noop,
          count: 12,
          countClassName: 'browser-section-count',
          children: 'Compute',
        }),
      ),
    ).toBe(
      '<button type="button" class="browser-section-header group-header" aria-expanded="false"><span class="inspector-chevron" aria-hidden="true"></span>Compute<span class="browser-section-count group-count">12</span></button>',
    );
  });

  it('puts the inspector chevron after the name, open, without a count', () => {
    expect(
      html(
        h(GroupHeader, {
          className: 'inspector-section-header',
          open: true,
          onToggle: noop,
          chevron: 'after',
          children: 'Content',
        }),
      ),
    ).toBe(
      '<button type="button" class="inspector-section-header group-header" aria-expanded="true">Content<span class="inspector-chevron is-open" aria-hidden="true"></span></button>',
    );
  });

  it('is whatever element the surface reads best as when it does not fold', () => {
    expect(
      html(h(GroupHeader, { as: 'p', className: 'palette-group', count: 4, children: 'Commands' })),
    ).toBe('<p class="palette-group group-header">Commands<span class="group-count">4</span></p>');
    expect(
      html(h(GroupHeader, { as: 'header', modifier: 'is-high', count: 1, children: 'Broken' })),
    ).toBe(
      '<header class="group-header is-high">Broken<span class="group-count">1</span></header>',
    );
    expect(
      html(
        h(GroupHeader, { as: 'span', className: 'icon-picker-section-header', children: 'Upload' }),
      ),
    ).toBe('<span class="icon-picker-section-header group-header">Upload</span>');
    expect(
      html(
        h(GroupHeader, {
          as: 'h3',
          className: 'shortcut-group-title',
          count: 0,
          children: 'Canvas',
        }),
      ),
    ).toBe(
      '<h3 class="shortcut-group-title group-header">Canvas<span class="group-count">0</span></h3>',
    );
  });
});

describe('Tile', () => {
  it('renders a draggable browser tile exactly', () => {
    const component = html(
      h(Tile, {
        className: 'browser-tile',
        title: 'Elastic Compute Cloud',
        dragKey: 'aws-ec2',
        onClick: noop,
        icon: h(SpriteIcon, { serviceKey: 'aws-ec2', className: 'browser-tile-icon' }),
        label: 'EC2',
        labelClassName: 'browser-tile-label',
        meta: h('span', { className: 'browser-tile-cloud' }, 'AWS'),
      }),
    );
    expect(component).toBe(
      '<button type="button" class="browser-tile" title="Elastic Compute Cloud" draggable="true"><svg class="browser-tile-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-aws-ec2" width="24" height="24"></use></svg><span class="browser-tile-label">EC2</span><span class="browser-tile-cloud">AWS</span></button>',
    );
  });

  it('renders a picker tile with its state and key, and the upload tile with its modifier', () => {
    expect(
      html(
        h(Tile, {
          className: 'icon-picker-tile',
          dataKey: 'gcp-gke',
          current: true,
          title: 'GKE',
          onClick: noop,
          icon: h('i', null),
          marker: h('span', { className: 'icon-picker-tile-cloud', 'aria-hidden': 'true' }),
          label: 'GKE',
          labelClassName: 'icon-picker-tile-label',
        }),
      ),
    ).toBe(
      '<button type="button" data-key="gcp-gke" class="icon-picker-tile is-current" aria-pressed="true" title="GKE"><i></i><span class="icon-picker-tile-cloud" aria-hidden="true"></span><span class="icon-picker-tile-label">GKE</span></button>',
    );
    expect(
      html(
        h(Tile, {
          className: 'browser-tile',
          modifier: 'is-upload',
          onClick: noop,
          icon: h('span', { className: 'browser-tile-icon is-upload', 'aria-hidden': 'true' }, '+'),
          label: 'Upload',
          labelClassName: 'browser-tile-label',
        }),
      ),
    ).toBe(
      '<button type="button" class="browser-tile is-upload"><span class="browser-tile-icon is-upload" aria-hidden="true">+</span><span class="browser-tile-label">Upload</span></button>',
    );
  });

  it('carries its key onto the canvas as text/plain', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        h(Tile, {
          className: 'browser-tile',
          dragKey: 'aws-ec2',
          onClick: noop,
          icon: null,
          label: 'EC2',
          labelClassName: 'browser-tile-label',
        }),
      ),
    );
    const set: string[] = [];
    const dataTransfer = {
      setData: (type: string, value: string) => set.push(`${type}=${value}`),
      effectAllowed: 'none',
    };
    const event = new Event('dragstart', { bubbles: true }) as Event & { dataTransfer: unknown };
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    act(() => {
      host.querySelector('button')!.dispatchEvent(event);
    });
    expect(set).toEqual(['text/plain=aws-ec2']);
    expect(dataTransfer.effectAllowed).toBe('copy');
    act(() => root.unmount());
  });
});

describe('Row', () => {
  it('renders a palette row exactly, with everything the list puts on it', () => {
    expect(
      html(
        h(Row, {
          className: 'palette-row',
          active: true,
          index: 3,
          id: 'palette-row-3',
          // `data-*` is what JSX lets through untyped; here it needs saying.
          ...({ 'data-index': 3 } as object),
          role: 'option',
          'aria-selected': true,
          onClick: noop,
          icon: h('span', { className: 'palette-icon', 'aria-hidden': 'true' }, 'i'),
          meta: h(Kbd, { className: 'palette-meta', children: '⌘Z' }),
          children: h('span', { className: 'palette-label' }, 'Undo'),
        }),
      ),
    ).toBe(
      '<button type="button" class="palette-row is-active" style="--i: 3;" id="palette-row-3" data-index="3" role="option" aria-selected="true"><span class="palette-icon" aria-hidden="true">i</span><span class="palette-label">Undo</span><kbd class="palette-meta">⌘Z</kbd></button>',
    );
  });

  it('renders an insight row with only a mark and text', () => {
    expect(
      html(
        h(Row, {
          className: 'insight-row',
          onClick: noop,
          icon: h('span', { className: 'insight-dot is-high', 'aria-hidden': 'true' }),
          children: h('span', { className: 'insight-text' }, 'No backups'),
        }),
      ),
    ).toBe(
      '<button type="button" class="insight-row"><span class="insight-dot is-high" aria-hidden="true"></span><span class="insight-text">No backups</span></button>',
    );
  });
});

describe('Field, NumberField and Section', () => {
  it('render the inspector anatomy exactly', () => {
    expect(
      html(
        h(Field, { label: 'Name', children: h('input', { className: 'input', readOnly: true }) }),
      ),
    ).toBe(
      '<label class="inspector-field"><span class="inspector-field-label">Name</span><input class="input" readonly=""></label>',
    );
    expect(html(h(NumberField, { label: 'X', value: 12, min: 0, onCommit: noop }))).toBe(
      '<label class="number-field"><span class="number-field-label">X</span><input class="number-field-input" inputmode="numeric" step="1" min="0" aria-label="X" type="number" value="12"></label>',
    );
    expect(html(h(Section, { title: 'Content', children: h('p', null, 'body') }))).toBe(
      '<section class="inspector-section" data-open="true"><button type="button" class="inspector-section-header group-header" aria-expanded="true">Content<span class="inspector-chevron is-open" aria-hidden="true"></span></button><div class="inspector-shutter"><div class="inspector-section-body"><p>body</p></div></div></section>',
    );
  });

  it('a closed section is inert and says so', () => {
    const out = html(h(Section, { title: 'T', defaultOpen: false, children: 'b' }));
    expect(out).toContain('data-open="false"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('<div class="inspector-shutter" inert="">');
    expect(out).toContain('<span class="inspector-chevron" aria-hidden="true"></span>');
  });
});
