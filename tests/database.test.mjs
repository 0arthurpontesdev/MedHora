import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase} from '../database.mjs';
import {createMailer,reminderText} from '../mailer.mjs';

test('SQLite persists medication and doses after reopening',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'medication-test-'));
  const file=path.join(folder,'test.sqlite');
  let store=openDatabase(file,null);
  const state={meds:[{id:'a',name:"Example's medication"}],taken:{dose1:true}};
  store.setRecipient('test@example.com');
  store.write(state,0);store.close();
  store=openDatabase(file,null);
  assert.deepEqual(store.read(),{...state,revision:1});
  assert.equal(store.recipient(),'test@example.com');
  store.close();
});
test('stale writes fail and preserve the database',()=>{
  const store=openDatabase(':memory:',null);
  store.write({meds:[{id:'first'}],taken:{}},0);
  assert.throws(()=>store.write({meds:[],taken:{}},0),{status:409});
  assert.equal(store.read().meds[0].id,'first');
  assert.throws(()=>store.write({meds:[{id:'duplicate'},{id:'duplicate'}],taken:{}},1));
  assert.equal(store.read().meds[0].id,'first');
  store.close();
});
test('sent and uncertain deliveries are not claimed twice; safe failures retry with delay',()=>{
  const store=openDatabase(':memory:',null);
  assert.equal(store.claim('a',100000),true);
  assert.equal(store.claim('a',100001),false);
  store.sent('a');assert.equal(store.claim('a',300000),false);
  store.claim('b',100000);store.failed('b',{code:'ETIMEDOUT'});
  assert.equal(store.claim('b',300000),false);
  store.claim('c',100000);store.failed('c',{code:'EAUTH'});
  assert.equal(store.claim('c',120000),false);
  assert.equal(store.claim('c',161000),true);
  store.close();
});
test('legacy JSON imports once including previous deliveries',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'medication-migrate-'));
  const json=path.join(folder,'legacy.json');const file=path.join(folder,'test.sqlite');
  fs.writeFileSync(json,JSON.stringify({meds:[{id:'legacy'}],taken:{a:true},sent:{a:'2026-09-15'}}));
  let store=openDatabase(file,json);
  assert.equal(store.read().meds[0].id,'legacy');assert.equal(store.claim('a',Date.now()),false);
  store.write({meds:[],taken:{}},1);store.close();
  store=openDatabase(file,json);assert.equal(store.read().meds.length,0);store.close();
});
test('email stays disabled until required settings are present',()=>{
  assert.equal(createMailer({}).configured,false);
  assert.ok(createMailer({}).missing.includes('SMTP_PASS'));
  const body=reminderText({at:Date.UTC(2026,8,15,11),name:'Teste',dose:'Dose teste'},'America/Fortaleza');
  assert.match(body,/08:00/);assert.match(body,/Teste/);
});
