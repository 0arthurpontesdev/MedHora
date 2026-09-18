import test from 'node:test';
import assert from 'node:assert/strict';
import {getMedicationReview} from './prescriptionReview.js';

test('dose and duration are optional when an interval schedule is complete', () => {
  const review = getMedicationReview({name: 'Tobramicina', scheduleType: 'interval', freq: 6, start: '09:12'});
  assert.equal(review.canRegister, true);
  assert.deepEqual(review.required, []);
  assert.deepEqual(review.optional, ['dose', 'duration']);
});

test('as-needed medication only requires a name and schedule type', () => {
  const review = getMedicationReview({name: 'Dipirona', scheduleType: 'asNeeded'});
  assert.equal(review.canRegister, true);
  assert.deepEqual(review.required, []);
});

test('fixed schedules explain the exact missing scheduling fields', () => {
  const interval = getMedicationReview({name: 'Medicamento', scheduleType: 'interval', freq: 12});
  assert.deepEqual(interval.required, ['start']);

  const times = getMedicationReview({name: 'Medicamento', scheduleType: 'times', times: ['25:00']});
  assert.deepEqual(times.required, ['times']);
});
