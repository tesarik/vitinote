import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, weekday } from '../js/util.js';

test('číslo týdne podle ISO 8601 a den v týdnu', () => {
  const cases = { '2026-10-07': 41, '2026-01-01': 1, '2027-01-01': 53, '2024-12-30': 1, '2021-01-03': 53, '2025-12-29': 1 };
  for (const [day, week] of Object.entries(cases)) assert.equal(isoWeek(day), week, day);
  assert.equal(weekday('2026-10-05'), 0);
  assert.equal(weekday('2026-10-11'), 6);
});
