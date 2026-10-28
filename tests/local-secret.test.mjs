import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm,chmod,symlink,link,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureLocalSecret} from '../scripts/local-secret.mjs';
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'uniesp-secrets-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('local secret generation is private and preserves existing material',()=>fixture(async dir=>{
 const path=join(dir,'secret');await ensureLocalSecret(path);const original=await readFile(path,'utf8');
 assert.match(original,/^[A-Za-z0-9_-]{43}$/);assert.equal((await stat(path)).mode&0o777,0o600);
 await chmod(path,0o644);await ensureLocalSecret(path);
 assert.equal(await readFile(path,'utf8'),original);assert.equal((await stat(path)).mode&0o777,0o600);
}));
test('local secret refuses symbolic and hard links without changing target',()=>fixture(async dir=>{
 const target=join(dir,'target');await writeFile(target,'existing-fixture',{mode:0o644});
 const symbolic=join(dir,'symbolic');await symlink(target,symbolic);await assert.rejects(ensureLocalSecret(symbolic));
 const hard=join(dir,'hard');await link(target,hard);await assert.rejects(ensureLocalSecret(hard));
 assert.equal(await readFile(target,'utf8'),'existing-fixture');assert.equal((await stat(target)).mode&0o777,0o644);
}));
test('local secret refuses directories and partial empty files',()=>fixture(async dir=>{
 const directory=join(dir,'directory');await mkdir(directory);await assert.rejects(ensureLocalSecret(directory));
 const empty=join(dir,'empty');await writeFile(empty,'');await assert.rejects(ensureLocalSecret(empty));assert.equal((await stat(empty)).size,0);
}));
