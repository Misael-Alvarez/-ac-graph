// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exitProps, usePresence, type Presence } from './usePresence';

/** Renders the hook and exposes its latest result. */
function mount(initial: string | null, fallbackMs?: number) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let latest: Presence<string> | null = null;
  let setValue: (value: string | null) => void = () => {};
  function Probe({ value }: { value: string | null }) {
    latest = usePresence(value, fallbackMs);
    return createElement('span', exitProps(latest.closing, latest.onExited), latest.shown ?? '');
  }
  let current = initial;
  let root: Root;
  const render = () => root.render(createElement(Probe, { value: current }));
  act(() => {
    root = createRoot(host);
    render();
  });
  setValue = (value) => {
    current = value;
    act(() => render());
  };
  return {
    get result() {
      return latest!;
    },
    setValue,
    host,
    unmount: () => act(() => root.unmount()),
  };
}

// React warns about `act` outside a test environment flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('usePresence', () => {
  it('shows the value while open, keeps it while closing, drops it when the exit ends', () => {
    const probe = mount('templates');
    expect(probe.result).toMatchObject({ shown: 'templates', closing: false });
    expect(probe.host.querySelector('span')?.hasAttribute('data-closing')).toBe(false);

    probe.setValue(null);
    expect(probe.result).toMatchObject({ shown: 'templates', closing: true });
    expect(probe.host.querySelector('span')?.hasAttribute('data-closing')).toBe(true);

    act(() => probe.result.onExited());
    expect(probe.result).toMatchObject({ shown: null, closing: false });
    probe.unmount();
  });

  it('falls back to a timer when no animation ends', () => {
    const probe = mount('menu', 100);
    probe.setValue(null);
    expect(probe.result.closing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(probe.result.closing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(probe.result).toMatchObject({ shown: null, closing: false });
    probe.unmount();
  });

  it('reopening during the exit cancels it, and a new value replaces the old at once', () => {
    const probe = mount('a');
    const firstKey = probe.result.key;
    probe.setValue(null);
    expect(probe.result.closing).toBe(true);
    probe.setValue('b');
    expect(probe.result).toMatchObject({ shown: 'b', closing: false });
    // A new opening, so contents keyed on it start afresh.
    expect(probe.result.key).toBe(firstKey + 1);
    probe.setValue('c');
    expect(probe.result).toMatchObject({ shown: 'c', closing: false, key: firstKey + 1 });
    probe.unmount();
  });

  it('only an *-out animation ending counts, and only while closing', () => {
    const onExited = vi.fn();
    const closed = exitProps(true, onExited);
    const event = (name: string) => ({ animationName: name }) as never;
    closed.onAnimationEnd(event('palette-in'));
    expect(onExited).not.toHaveBeenCalled();
    closed.onAnimationEnd(event('dialog-out'));
    expect(onExited).toHaveBeenCalledTimes(1);
    expect(closed['data-closing']).toBe('');

    const open = exitProps(false, onExited);
    open.onAnimationEnd(event('dialog-out'));
    expect(onExited).toHaveBeenCalledTimes(1);
    expect(open['data-closing']).toBeUndefined();
  });
});
