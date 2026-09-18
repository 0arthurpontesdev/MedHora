import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanMedicationQuery, medicationLookupKey, researchMedicationByName, researchMedicationInWikipedia, sourceMatchesMedication, summarizeSourceExtract} from './medicationResearch.js';

test('source summaries remain short and stop after three sentences', () => {
  const summary = summarizeSourceExtract('Primeira frase. Segunda frase! Terceira frase? Quarta frase.');
  assert.equal(summary, 'Primeira frase. Segunda frase! Terceira frase?');
});

test('empty source extracts remain empty instead of being invented', () => {
  assert.equal(summarizeSourceExtract(''), '');
});

test('dose is removed before researching the medication name', () => {
  assert.equal(cleanMedicationQuery('Dipirona 1 g'), 'Dipirona');
  assert.equal(cleanMedicationQuery('Amoxicilina 875 mg + clavulanato 125 mg'), 'Amoxicilina + clavulanato');
});

test('unrelated search results are rejected', () => {
  const unrelated = {title: 'Bilastina', extract: 'Bilastina é um anti-histamínico.'};
  assert.equal(sourceMatchesMedication('Cimegripe', unrelated), false);
  assert.equal(sourceMatchesMedication('Bilastina 20 mg', unrelated), true);
});

test('similar substances are not accepted only because they appear in the extract',()=>{
  assert.equal(sourceMatchesMedication('Prednisolona',{title:'Prednisona',extract:'A prednisona é convertida em prednisolona.'}),false);
});

test('commercial names and active ingredients resolve to a precise lookup key',()=>{
  assert.equal(medicationLookupKey('Cimegripe MUC — acetilcisteína 600 mg'),'acetilcisteina');
  assert.equal(medicationLookupKey('Busonid — budesonida 50 mcg'),'budesonida');
  assert.equal(medicationLookupKey('Amoxicilina + clavulanato 875 mg + 125 mg'),'amoxicilina_clavulanato');
  assert.equal(medicationLookupKey('Soro fisiológico 0,9%'),'soro_fisiologico');
});

test('known agenda medications use verified precise summaries without network search',async()=>{
  const examples=[
    ['Cimegripe MUC — acetilcisteína 600 mg',/mucolítico/i],
    ['Amoxicilina + clavulanato 875 mg + 125 mg',/associação antibiótica/i],
    ['Busonid — budesonida 50 mcg',/spray nasal/i],
    ['Tobramicina 0,3%',/oftálmica/i],
    ['Soro fisiológico 0,9%',/cloreto de sódio/i],
    ['Prednisolona 20 mg',/não é a mesma substância que prednisona/i],
  ];
  for(const [name,expected] of examples){
    const result=await researchMedicationByName(name);
    assert.equal(result.name,cleanMedicationQuery(name));
    assert.match(result.summary,expected);
  }
});

test('Dorflex uses a verified product source and distinguishes product versions',async()=>{
  const result=await researchMedicationByName('Dorflex');
  assert.match(result.summary,/versão tradicional/);
  assert.match(result.summary,/composições diferentes/);
  assert.match(result.url,/dorflex\.com\.br/);
});

test('generic fallback researches an arbitrary medication name without a catalog entry',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.match(String(url),/pt\.wikipedia\.org/);
    return {ok:true,json:async()=>({query:{pages:{'42':{
      title:'Medicamento Exemplo',
      fullurl:'https://pt.wikipedia.org/wiki/Medicamento_Exemplo',
      extract:'Medicamento Exemplo é usado para uma finalidade descrita em fonte pública. A indicação depende da apresentação.',
    }}}})};
  };
  try{
    const result=await researchMedicationInWikipedia('Medicamento Exemplo 20 mg');
    assert.equal(result.name,'Medicamento Exemplo');
    assert.match(result.summary,/finalidade descrita/);
    assert.match(result.officialSource.url,/consultas\.anvisa\.gov\.br/);
  }finally{
    globalThis.fetch=originalFetch;
  }
});
