import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_PREFS, parseLibraryPrefs, sortDiagrams } from './prefs';

const item = (id: string, title: string, updatedAt: string, createdAt = updatedAt) => ({
  id,
  title,
  updatedAt,
  createdAt,
});

describe('parseLibraryPrefs', () => {
  it('defaults on nothing, junk or a wrong shape', () => {
    expect(parseLibraryPrefs(null)).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(parseLibraryPrefs('{nope')).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(parseLibraryPrefs('{"sort":"loud","favourites":"x"}')).toEqual(DEFAULT_LIBRARY_PREFS);
    expect(parseLibraryPrefs('{"sort":"name","favourites":["a",1,null,"b"]}')).toEqual({
      sort: 'name',
      favourites: ['a', 'b'],
    });
  });
});

describe('sortDiagrams', () => {
  const items = [
    item('a', 'Zeta', '2026-01-03', '2026-01-01'),
    item('b', 'alpha', '2026-01-01', '2026-01-03'),
    item('c', 'Beta 10', '2026-01-02', '2026-01-02'),
    item('d', 'Beta 2', '2026-01-04', '2026-01-04'),
  ];

  it('orders by recent edit, name (naturally, ignoring case) or creation', () => {
    expect(sortDiagrams(items, 'recent', []).map((i) => i.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(sortDiagrams(items, 'name', []).map((i) => i.title)).toEqual([
      'alpha',
      'Beta 2',
      'Beta 10',
      'Zeta',
    ]);
    expect(sortDiagrams(items, 'created', []).map((i) => i.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('puts favourites first, in the same order among themselves', () => {
    expect(sortDiagrams(items, 'recent', ['b', 'c']).map((i) => i.id)).toEqual([
      'c',
      'b',
      'd',
      'a',
    ]);
    expect(sortDiagrams(items, 'name', ['a']).map((i) => i.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('does not touch the input', () => {
    const before = items.map((i) => i.id);
    sortDiagrams(items, 'name', ['c']);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});
