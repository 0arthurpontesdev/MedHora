import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dosesBetween} from './schedule.js';
const med = {id:'a', startsAt:'2026-09-15T20:00:00', freq:6, days:2};
test('intervals continue across midnight and duration ends exclusively', () => {
  const doses = dosesBetween([med], new Date('2026-09-16T00:00:00'), new Date('2026-09-18T00:00:00'));
  assert.deepEqual(doses.map(d => new Date(d.at).getHours()), [2,8,14,20,2,8,14]);
  assert.equal(new Set(doses.map(d=>d.doseKey)).size, doses.length);
});
test('once daily for one day produces one dose', () => {
  assert.equal(dosesBetween([{...med, freq:24, days:1}], new Date('2026-09-15'), new Date('2026-09-18')).length, 1);
});
test('invalid intervals do not hang the scheduler', () => {
  assert.deepEqual(dosesBetween([{...med, freq:0}], new Date('2026-09-15'), new Date('2026-09-18')), []);
});
test('custom daily times generate the requested schedule', () => {
  const doses=dosesBetween([{id:'b',date:'2026-09-15',days:2,scheduleType:'times',status:'active',times:['08:00','14:00','20:00']}],new Date('2026-09-15T00:00:00'),new Date('2026-09-17T00:00:00'));
  assert.deepEqual(doses.map(d=>d.mins),[480,840,1200,480,840,1200]);
});
test('schedules without a duration continue through the requested day', () => {
  const interval=dosesBetween([{...med,days:0}],new Date('2026-09-16T00:00:00'),new Date('2026-09-17T00:00:00'));
  assert.deepEqual(interval.map(d=>new Date(d.at).getHours()),[2,8,14,20]);
  const custom=dosesBetween([{id:'c',date:'2026-09-15',days:0,scheduleType:'times',status:'active',times:['08:00','20:00']}],new Date('2026-09-16T00:00:00'),new Date('2026-09-17T00:00:00'));
  assert.deepEqual(custom.map(d=>d.mins),[480,1200]);
});
test('paused and ended medication do not generate doses', () => {
  assert.equal(dosesBetween([{...med,status:'paused'},{...med,id:'z',status:'ended'}],new Date('2026-09-15'),new Date('2026-09-18')).length,0);
});

test('a new interval anchor changes future times without extending treatment duration',()=>{
  const med={id:'m1',name:'Teste',status:'active',scheduleType:'interval',freq:6,days:2,startsAt:'2026-09-16T09:00:00',scheduleAnchorAt:'2026-09-16T10:30:00'};
  const doses=dosesBetween([med],new Date('2026-09-16T00:00:00'),new Date('2026-09-18T12:00:00'));
  assert.equal(new Date(doses[0].at).getHours(),10);
  assert.equal(new Date(doses[0].at).getMinutes(),30);
  assert.ok(doses.every(dose=>dose.at<+new Date('2026-09-18T09:00:00')));
});
