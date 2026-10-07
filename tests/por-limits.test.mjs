import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useLimits, bbchAllowed, limitsLabel } from '../js/por-limits.js';

const lim = (note, dose = '') => useLimits({ note, dose });

test('počet aplikací a odstup', () => {
  assert.deepEqual(lim('1) od: 15-18 BBCH3) max. 8x, v intervalu 7 dnů'), { maxApplications: 8, minIntervalDays: 7, bbch: [[15, 99]] });
  assert.equal(lim('1) od: 61 BBCH, do: 75 BBCH3) max. 3x za rok, v intervalu 10-14 dnů').minIntervalDays, 10);
  assert.equal(lim('3) max. 4x za rok (max 2x do BBCH 61, max 2 x od BBCH 61), v intervalu 7-12 dnů').maxApplications, 4);
  assert.equal(lim('1) od: 20 BBCH3) max. 5x za rok, v intervalu 3-4 týdny').minIntervalDays, 21);
  assert.equal(lim('1) od: 68 BBCH, do: 89 BBCH3) max. 4x za rok, v intervalu min.2 dny').minIntervalDays, 2);
  assert.equal(lim('1) od: 55 BBCH, do: 57 BBCH3) 1-3x za rok').maxApplications, 3);
  assert.equal(lim('2) pravé plísně3) bez omezení, v intervalu 10-15 dní').maxApplications, null);
  assert.deepEqual(lim('', '75-225 g ú.l./ha , 100-300 l vody/ha max.12x za rok v intervalu 5 dnů'), { maxApplications: 12, minIntervalDays: 5, bbch: [] });
});

test('okna fenofází BBCH', () => {
  assert.deepEqual(lim('1) od: 71 BBCH, do: 81 BBCH3) max. 4x').bbch, [[71, 81]]);
  assert.deepEqual(lim('1) od: 53 BBCH, do: 55 BBCH a, od: 71 BBCH, do: 89 BBCH3) max. 2x').bbch, [[53, 55], [71, 89]]);
  assert.deepEqual(lim('1) ve f. 17 BBCH, od: 61 BBCH, do: 85 BBCH3) max. 8x').bbch, [[17, 17], [61, 85]]);
  assert.deepEqual(lim('1) od: 00 BBCH - tvorba pupenů, do: 69 BBCH - konec kvetení3) max. 3x').bbch, [[0, 69]]);
  assert.ok(bbchAllowed([[53, 55], [71, 89]], 72));
  assert.ok(!bbchAllowed([[53, 55], [71, 89]], 60));
  assert.ok(bbchAllowed([], 10));
});

test('popisek omezení', () => {
  assert.equal(limitsLabel(lim('1) od: 15 BBCH, do: 77 BBCH3) max. 4x za rok, v intervalu 10 dnů')), 'max. 4× za rok, odstup 10 dní, BBCH 15–77');
});
