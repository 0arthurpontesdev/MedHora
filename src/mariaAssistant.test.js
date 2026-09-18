import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerAgendaQuestion,
  answerFamilyAgendaQuestion,
  answerMariaProfileQuestion,
  emergencyResponse,
  extractMedicationSubject,
  isMedicationDefinitionQuestion,
  isCollectiveMedicationPurposeQuestion,
  needsMedicalSources,
  outOfScopeResponse,
  unsafeMedicationAdviceResponse,
} from './mariaLogic.js';

const context = {
  medications: [{name: 'Tobramicina', dose: '1 gota', status: 'active', scheduleType: 'interval', frequencyHours: 6, start: '09:12', times: []}],
  today: {total: 4, taken: 2, pending: 2, takenItems: [{name: 'Tobramicina', time: '09:12'}, {name: 'Tobramicina', time: '15:12'}], pendingItems: [{name: 'Tobramicina', time: '21:12'}, {name: 'Tobramicina', time: '03:12'}]},
};

test('agenda questions use exact local counts', () => {
  const answer = answerAgendaQuestion('Quanto eu tomei hoje e quantas doses faltam?', context);
  assert.match(answer, /2 de 4/);
  assert.match(answer, /Faltam 2/);
});

test('M.A.R.I.A. explains her name locally without depending on the model',()=>{
  const answer=answerMariaProfileQuestion('Pq vc se chama Maria?');
  assert.match(answer,/Mecanismo de Apoio para Registro e Informação Assistencial/);
  assert.match(answerMariaProfileQuestion('Por que você se chama M.A.R.I.A.?'),/Mecanismo de Apoio/);
});

test('common conversation and app help are answered locally',()=>{
  assert.match(answerMariaProfileQuestion('Oi'),/Olá/);
  assert.match(answerMariaProfileQuestion('O que você pode fazer?'),/receituário/);
  assert.match(answerMariaProfileQuestion('Como cadastrar um receituário?'),/Anexar receituário/);
});

test('questions outside the assistant scope receive a quick local redirect',()=>{
  assert.match(outOfScopeResponse('Como programar um site?'),/foge do que fui criada/);
  assert.equal(outOfScopeResponse('Qual é o horário do meu remédio?'),'');
});

test('urgent symptoms receive immediate emergency direction', () => {
  assert.match(emergencyResponse('Estou com falta de ar'), /SAMU.*192/);
  assert.match(emergencyResponse('Não estou bem hoje'), /profissional de saúde/);
  assert.match(emergencyResponse('n estou bem'), /profissional de saúde/);
  assert.match(emergencyResponse('um medicamento me fez mal'), /profissional de saúde/);
  assert.equal(emergencyResponse('Quais são meus medicamentos?'), '');
});

test('medication purpose questions require researched sources', () => {
  assert.equal(needsMedicalSources('Pra que serve a tobramicina?'), true);
  assert.equal(needsMedicalSources('Quantas doses faltam?'), false);
  assert.equal(needsMedicalSources('O que é Dorflex?'), true);
  assert.equal(isMedicationDefinitionQuestion('oq é dorflex'),true);
});

test('extracts only the medicine explicitly named by the user', () => {
  assert.equal(extractMedicationSubject('Para que serve Cimegripe?'), 'Cimegripe');
  assert.equal(extractMedicationSubject('Para que serve a Tobramicina 0,3%?'), 'Tobramicina 0,3%');
  assert.equal(extractMedicationSubject('O que é Tobramicina 0.3%?'), 'Tobramicina 0.3%');
  assert.equal(extractMedicationSubject('Para que servem meus medicamentos?'), '');
  assert.equal(extractMedicationSubject('oq é dorflex'), 'dorflex');
});

test('collective medication-purpose questions do not invent a medicine named meus medicamentos',()=>{
  assert.equal(isCollectiveMedicationPurposeQuestion('Pra que serve meus medicamentos?'),true);
  assert.equal(isCollectiveMedicationPurposeQuestion('pra q serve meus medicamentos?'),true);
  assert.equal(isCollectiveMedicationPurposeQuestion('para q servem todos os meus remédios?'),true);
  assert.equal(isCollectiveMedicationPurposeQuestion('Para que servem todos os meus remédios?'),true);
  assert.equal(extractMedicationSubject('pra que serve meus medicamentos?'),'');
  assert.equal(extractMedicationSubject('pra q serve meus medicamentos?'),'');
});

test('specific schedule questions answer only about the named medicine', () => {
  const answer = answerAgendaQuestion('Quantas doses de Tobramicina faltam hoje?', context);
  assert.match(answer, /Tobramicina/);
  assert.match(answer, /a cada 6 hora/);
  assert.match(answer, /2 pendente/);
});

test('requests to make treatment decisions are refused deterministically', () => {
  const answer = unsafeMedicationAdviceResponse('Posso tomar o dobro da dose?');
  assert.match(answer, /Não posso decidir/);
  assert.match(answer, /médico ou farmacêutico/);
});

test('saved instructions are reported instead of being mistaken for medical advice', () => {
  const specific=answerAgendaQuestion('Na minha agenda, qual o procedimento da Tobramicina?',context);
  assert.match(specific,/Segundo o que está cadastrado/);
  assert.match(specific,/a cada 6 hora/);
  const all=answerAgendaQuestion('Como devo tomar meus medicamentos com base na agenda?',context);
  assert.match(all,/Tobramicina/);
  assert.match(all,/09:12/);
  assert.equal(unsafeMedicationAdviceResponse('Como devo tomar meus medicamentos com base na agenda?'),'');
});

test('additional agenda questions use structured local data',()=>{
  const detailed={...context,
    today:{...context.today,lateItems:[{name:'Tobramicina',time:'09:12'}],lastScheduledTime:'21:12'},
    lastTaken:{name:'Tobramicina',date:'16/09',time:'15:12'},
    paused:['Bilastina'],
    endingThisWeek:[{name:'Prednisolona',date:'19/09'}],
  };
  assert.match(answerAgendaQuestion('Qual medicamento está atrasado?',detailed),/Tobramicina/);
  assert.match(answerAgendaQuestion('Qual foi minha última dose?',detailed),/15:12/);
  assert.match(answerAgendaQuestion('Que horas termina minha agenda hoje?',detailed),/21:12/);
  assert.match(answerAgendaQuestion('Quais tratamentos terminam esta semana?',detailed),/Prednisolona/);
  assert.match(answerAgendaQuestion('Tenho algum medicamento pausado?',detailed),/Bilastina/);
});

test('today administration questions list pending agenda doses',()=>{
  const answer=answerAgendaQuestion('Quais medicamentos preciso administrar hoje?',context);
  assert.match(answer,/pendentes/);
  assert.match(answer,/21:12/);
});


test('app navigation questions receive direct instructions',()=>{
  assert.match(answerMariaProfileQuestion('Como adicionar um familiar?'),/Família/);
  assert.match(answerMariaProfileQuestion('Como ativar notificações no celular?'),/Celular/);
  assert.match(answerMariaProfileQuestion('Como exportar minha agenda?'),/Backup/);
  assert.match(answerMariaProfileQuestion('Onde vejo as doses sem confirmação?'),/Histórico/);
  assert.match(answerMariaProfileQuestion('Como gerar um relatório dos últimos 7 dias para o médico?'),/Gerar PDF/);
});

test('caregiver questions only use authorized family agenda data',()=>{
  const now=new Date('2026-09-16T14:10:00');
  const meds=[{id:'m1',name:'Amoxicilina',dose:'1 comprimido',status:'active',scheduleType:'times',times:['14:00'],date:'2026-09-16',days:2}];
  const key='2026-09-16-m1-840';
  const family=[{name:'João Silva',meds,taken:{[key]:true}}];
  assert.match(answerFamilyAgendaQuestion('O João já tomou o remédio dele das 14h?',family,now),/Sim/);
  assert.match(answerFamilyAgendaQuestion('Quem tem medicamento para tomar agora à tarde?',family,now),/não encontrei doses pendentes/i);
});

test('assistant identifies frequently unconfirmed medicines without calling them forgotten',()=>{
  const detailed={...context,frequentlyMissed:[{name:'Tobramicina',count:3}],completedTreatments:['Amoxicilina']};
  assert.match(answerAgendaQuestion('Quais medicamentos eu costumo esquecer mais?',detailed),/Tobramicina/);
  assert.match(answerAgendaQuestion('Quais tratamentos foram concluídos?',detailed),/Amoxicilina/);
});
