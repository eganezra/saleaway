import { describe, expect, it } from 'vitest';
import { rankStores } from '../src/rank';

interface Item {
  name: string;
  percent: number | null;
  rank: number;
  extra?: string;
}
const item = (name: string, percent: number | null, rank: number): Item => ({ name, percent, rank });
const names = (items: Item[]): string[] => items.map((i) => i.name);

describe('rankStores (FR14)', () => {
  it('puts the biggest known percentage first', () => {
    expect(names(rankStores([item('a', 20, 1), item('b', 70, 5), item('c', 45, 3)]))).toEqual(['b', 'c', 'a']);
  });
  it('puts "On sale" stores after every known percentage, lowest rank first', () => {
    expect(names(rankStores([item('a', null, 3), item('b', 10, 9), item('c', null, 1), item('d', 60, 8)]))).toEqual(['d', 'b', 'c', 'a']);
  });
  it('breaks a tie between equal percentages by rank', () => {
    expect(names(rankStores([item('a', 50, 7), item('b', 50, 2), item('c', 50, 4)]))).toEqual(['b', 'c', 'a']);
  });
  it('keeps the input order when the percentage and the rank are both equal (stable)', () => {
    expect(names(rankStores([item('a', 30, 5), item('b', 30, 5), item('c', null, 9), item('d', null, 9)]))).toEqual(['a', 'b', 'c', 'd']);
  });
  it('orders a mix of all of these', () => {
    const input = [item('on-sale-9', null, 9), item('p40-r2', 40, 2), item('on-sale-1', null, 1), item('p90-r8', 90, 8), item('p40-r1', 40, 1), item('p5-r3', 5, 3)];
    expect(names(rankStores(input))).toEqual(['p90-r8', 'p40-r1', 'p40-r2', 'p5-r3', 'on-sale-1', 'on-sale-9']);
  });
  it('handles an empty list and a single item', () => {
    expect(rankStores([])).toEqual([]);
    const one = item('a', null, 1);
    expect(rankStores([one])).toEqual([one]);
  });
  it('puts a rank that is not a real number last in its group, without throwing', () => {
    const input = [item('nan', null, Number.NaN), item('inf', null, Number.POSITIVE_INFINITY), item('r2', null, 2), item('p-nan', 30, Number.NaN), item('p-r9', 30, 9)];
    expect(names(rankStores(input))).toEqual(['p-r9', 'p-nan', 'r2', 'nan', 'inf']);
  });
  it('sorts a negative zero rank like zero', () => {
    expect(names(rankStores([item('a', null, 1), item('b', null, -0), item('c', null, 0)]))).toEqual(['b', 'c', 'a']);
  });
  it('counts 0 as a known percentage (the caller keeps it out of range: this function does not judge)', () => {
    expect(names(rankStores([item('a', null, 1), item('b', 0, 9)]))).toEqual(['b', 'a']);
  });
  it('returns a new array of the same objects, keeps extra properties, and changes nothing', () => {
    const a: Item = { ...item('a', 10, 2), extra: 'keep' };
    const b = item('b', 80, 1);
    const input = [a, b];
    const out = rankStores(input);
    expect(out).not.toBe(input);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
    expect(out[1]?.extra).toBe('keep');
    expect(input).toEqual([a, b]);
    expect(input[0]).toBe(a);
    expect(a).toEqual({ name: 'a', percent: 10, rank: 2, extra: 'keep' });
  });
});
