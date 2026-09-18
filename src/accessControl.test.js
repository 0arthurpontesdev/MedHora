import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAgendaPermissions} from './accessControl.js';

test('adult owner manages and records own agenda',()=>assert.deepEqual(resolveAgendaPermissions({viewingOwn:true}),{canManage:true,canToggle:true,readOnly:false}));
test('managed minor records doses but cannot alter medication',()=>assert.deepEqual(resolveAgendaPermissions({viewingOwn:true,managedMinor:true}),{canManage:false,canToggle:true,readOnly:false}));
test('assisted elderly person records doses but family administrator manages medication',()=>assert.deepEqual(resolveAgendaPermissions({viewingOwn:true,managedAccount:true}),{canManage:false,canToggle:true,readOnly:false}));
test('guardian manages and records dependent agenda',()=>assert.deepEqual(resolveAgendaPermissions({selectedDependent:true}),{canManage:true,canToggle:true,readOnly:false}));
test('family viewer has read-only access',()=>assert.deepEqual(resolveAgendaPermissions({}),{canManage:false,canToggle:false,readOnly:true}));
test('paired phone records doses but cannot alter medication',()=>assert.deepEqual(resolveAgendaPermissions({pairedMode:true}),{canManage:false,canToggle:true,readOnly:false}));
