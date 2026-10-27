import { describe, expect, it } from 'vitest';
import { formatDuration, localToUtcIso, parseDuration, toLocalDisplay } from '../../src/time.js';

describe('parseDuration', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['45m', 2700],
    ['2h', 7200],
    ['1.5h', 5400],
    ['1:30', 90],
    ['1:23:40', 5020],
    ['0:05', 5],
    [' 10s ', 10],
  ])('parses %j', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'abc', '1:2', '1:60', '1:60:00', '-5', '5x'])('rejects %j', (input) => {
    expect(() => parseDuration(input)).toThrow(/Invalid duration/);
  });
});

describe('formatDuration', () => {
  it.each([
    [5020, '1:23:40'],
    [59.6, '0:01:00'],
    [0, '0:00:00'],
  ])('formats %d', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe('localToUtcIso', () => {
  it.each([
    ['2026-10-28T20:00', '2026-10-29T00:00:00.000Z'], // EDT, UTC-4
    ['2026-10-28 20:00:30', '2026-10-29T00:00:30.000Z'],
    ['2026-12-15T20:00', '2026-12-16T01:00:00.000Z'], // EST, UTC-5
    ['2026-10-31T12:00', '2026-10-31T16:00:00.000Z'], // day before DST ends
    ['2026-11-01T12:00', '2026-11-01T17:00:00.000Z'], // DST ended 2am that morning
  ])('converts Florida time %s', (input, expected) => {
    expect(localToUtcIso(input)).toBe(expected);
  });

  it.each(['2026-10-28', '2026-13-01T10:00', '2026-02-30T10:00', '2026-10-28T20:00Z', '2026-10-28T25:00'])(
    'rejects %j',
    (input) => {
      expect(() => localToUtcIso(input)).toThrow(/Invalid schedule/);
    },
  );
});

describe('toLocalDisplay', () => {
  it('shows a UTC timestamp in Florida time', () => {
    expect(toLocalDisplay('2026-10-29T00:00:00.000Z')).toBe('2026-10-28 20:00');
  });
});
