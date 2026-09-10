import { describe, expect, it } from 'vitest';
import { createClock } from './clock';

describe('createClock', () => {
  it('never returns the same stamp twice, even within one millisecond', () => {
    const clock = createClock(() => 1_700_000_000_000);
    const a = clock();
    const b = clock();
    const c = clock();
    expect(a < b && b < c).toBe(true);
  });

  it('always sorts after the revision it was asked to follow', () => {
    const clock = createClock(() => 1_700_000_000_000);
    const future = new Date(1_800_000_000_000).toISOString();
    expect(clock(future) > future).toBe(true);
  });

  it('ignores an unparseable "after"', () => {
    const clock = createClock(() => 1_700_000_000_000);
    expect(clock('not a date')).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('produces ISO strings', () => {
    expect(createClock()()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
