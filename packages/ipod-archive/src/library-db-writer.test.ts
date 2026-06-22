/**
 * Unit tests for the pure pieces of the catalogue writer.
 *
 * `flattenSmartRule` is the one piece of pure logic on the smart-playlist path,
 * so it is pinned here independently of whether the libgpod test harness can
 * synthesise a smart playlist with rules (it is exercised end-to-end in the
 * integration suite when it can). These tests construct synthetic `SPLRule`
 * objects directly, so they never touch a device or libgpod.
 */

import { describe, expect, test } from 'bun:test';
import { SPLField, SPLAction, type SPLRule } from '@podkit/libgpod-node';
import { flattenSmartRule } from './library-db-writer.js';

describe('flattenSmartRule', () => {
  test('flattens a string rule, leaving numeric operands null', () => {
    const rule: SPLRule = {
      field: SPLField.Genre,
      action: SPLAction.Contains,
      string: 'Rock',
    };

    const row = flattenSmartRule(0x1122334455667788n, 0, rule);

    expect(row).toEqual({
      playlist_id: '1234605616436508552', // 0x1122334455667788 as decimal
      rule_index: 0,
      field: SPLField.Genre,
      action: SPLAction.Contains,
      string: 'Rock',
      from_value: null,
      to_value: null,
      from_date: null,
      to_date: null,
      from_units: null,
      to_units: null,
    });
  });

  test('flattens a numeric rule, leaving string null', () => {
    const rule: SPLRule = {
      field: SPLField.Rating,
      action: SPLAction.IsGreaterThan,
      fromValue: 80,
    };

    const row = flattenSmartRule(42n, 3, rule);

    expect(row.playlist_id).toBe('42');
    expect(row.rule_index).toBe(3);
    expect(row.field).toBe(SPLField.Rating);
    expect(row.action).toBe(SPLAction.IsGreaterThan);
    expect(row.string).toBeNull();
    expect(row.from_value).toBe(80);
    expect(row.to_value).toBeNull();
  });

  test('preserves a range rule and its date/unit operands', () => {
    const rule: SPLRule = {
      field: SPLField.Year,
      action: SPLAction.IsInTheRange,
      fromValue: 1990,
      toValue: 1999,
      fromDate: 100,
      toDate: 200,
      fromUnits: 86400,
      toUnits: 604800,
    };

    const row = flattenSmartRule(1n, 1, rule);

    expect(row).toMatchObject({
      from_value: 1990,
      to_value: 1999,
      from_date: 100,
      to_date: 200,
      from_units: 86400,
      to_units: 604800,
    });
  });

  test('keeps the unsigned 64-bit playlist id exact (no precision loss)', () => {
    // A value above 2^53 would round if treated as a JS number — flattenSmartRule
    // must stringify the bigint, not coerce it.
    const big = 0xfedcba9876543210n;
    const row = flattenSmartRule(big, 0, {
      field: SPLField.Artist,
      action: SPLAction.Is,
      string: 'x',
    });
    expect(row.playlist_id).toBe(big.toString());
    expect(BigInt(row.playlist_id)).toBe(big);
  });
});
