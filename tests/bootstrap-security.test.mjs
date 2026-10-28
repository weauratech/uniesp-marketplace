import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {provisionIdentity} from '../scripts/provisioning-identity.mjs';

async function fixture(fn) {
 const dir=await mkdtemp(join(tmpdir(),'uniesp-bootstrap-'));
 const registryPath=join(dir,'identities.json');
 const state={users:[],creates:0,grants:[]};
 const api=async(path,method='GET',body)=>{
  if(path.includes('/users?'))return state.users;
  if(path==='/uniesp/users'&&method==='POST') {state.creates++;state.users=[{id:'created-by-bootstrap',username:body.username}];return {id:state.users[0].id};}
  if(path==='/uniesp/roles/admin')return {id:'role-admin',name:'admin'};
  if(path.endsWith('/role-mappings/realm')){state.grants.push(path);return;}
  throw Error('Unexpected fixture request');
 };
 const run=()=>provisionIdentity({api,realm:'uniesp',account:{username:'admin@uniesp.local'},role:'admin',registryPath});
 try {await fn({state,run,registryPath});}finally {await rm(dir,{recursive:true,force:true});}
}
test('bootstrap refuses an unregistered pre-existing reserved account without granting roles',()=>fixture(async({state,run})=>{
 state.users=[{id:'self-registered',username:'admin@uniesp.local'}];
 await assert.rejects(run,/Reserved identity already exists/);
 assert.equal(state.creates,0);assert.deepEqual(state.grants,[]);
}));
test('bootstrap records created ID privately and repeated runs target only the same identity',()=>fixture(async({state,run,registryPath})=>{
 assert.equal(await run(),'created-by-bootstrap');
 assert.equal((await stat(registryPath)).mode&0o777,0o600);
 assert.equal(JSON.parse(await readFile(registryPath,'utf8')).users['admin@uniesp.local'],'created-by-bootstrap');
 assert.equal(await run(),'created-by-bootstrap');assert.equal(state.creates,1);assert.equal(state.grants.length,2);
 state.users=[{id:'replacement',username:'admin@uniesp.local'}];
 await assert.rejects(run,/Provisioned identity mismatch/);assert.equal(state.grants.length,2);
}));
test('bootstrap refuses malformed registries and missing registered identities',()=>fixture(async({state,run,registryPath})=>{
 await writeFile(registryPath,'invalid-json');await assert.rejects(run);assert.deepEqual(state.grants,[]);
 await writeFile(registryPath,JSON.stringify({version:1,users:{'admin@uniesp.local':'deleted'}}));
 await assert.rejects(run,/Provisioned identity mismatch/);assert.equal(state.creates,0);
}));
