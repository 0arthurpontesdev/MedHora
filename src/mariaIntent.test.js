import test from 'node:test';
import assert from 'node:assert/strict';
import {answerStructuredMariaIntent, normalizeMariaIntent} from './mariaIntent.js';

const context = {
  medications: [
    {name:'Tobramicina 0,3%',dose:'1 gota',status:'active',scheduleType:'interval',frequencyHours:6,start:'09:00',times:[]},
    {name:'Bilastina',dose:'20 mg',status:'paused',scheduleType:'times',frequencyHours:0,start:'',times:['08:00']},
  ],
  today: {
    total: 3,
    taken: 1,
    pending: 2,
    takenItems: [{name:'Tobramicina 0,3%',time:'09:00'}],
    pendingItems: [{name:'Tobramicina 0,3%',time:'15:00'},{name:'Tobramicina 0,3%',time:'21:00'}],
    lateItems: [{name:'Tobramicina 0,3%',time:'15:00'}],
    lastScheduledTime:'21:00',
  },
  lastTaken:{name:'Tobramicina 0,3%',date:'17/09',time:'09:00'},
  paused:['Bilastina'],
  endingThisWeek:[],
  frequentlyMissed:[{name:'Tobramicina 0,3%',count:2}],
  completedTreatments:[],
};

test('normalizes model output to a closed set of safe intents', () => {
  assert.equal(normalizeMariaIntent({intent:'delete_everything'}).intent, 'unknown');
  assert.deepEqual(normalizeMariaIntent({intent:'next_dose',period:'today',scope:'self',confidence:4}), {
    intent:'next_dose',medication:'',person:'',period:'today',scope:'self',confidence:1,
  });
});

test('answers semantic agenda intents from trusted local context', () => {
  assert.match(answerStructuredMariaIntent({intent:'next_dose'}, context), /15:00/);
  assert.match(answerStructuredMariaIntent({intent:'today_summary'}, context), /1 administrada/);
  assert.match(answerStructuredMariaIntent({intent:'paused_medications'}, context), /Bilastina/);
});

test('uses extracted medication entity without changing saved instructions', () => {
  const answer = answerStructuredMariaIntent({intent:'medication_schedule',medication:'tobramicina'}, context);
  assert.match(answer, /a cada 6 hora/);
  assert.match(answer, /sem alterar a prescrição/);
});

test('filters pending doses by a semantically classified period', () => {
  const afternoon = answerStructuredMariaIntent({intent:'pending_doses',period:'afternoon'}, context);
  assert.match(afternoon, /15:00/);
  assert.doesNotMatch(afternoon, /21:00/);
});
