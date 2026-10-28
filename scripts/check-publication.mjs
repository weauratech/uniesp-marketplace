// Supplemental publication guard. This is not a replacement for a secret scanner.
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const forbiddenPath=/(^|\/)(?:data|node_modules|dist|\.local-build|\.git|test-results|playwright-report|coverage)(\/|$)|(?:^|\/)\.env(?:\..*)?$|\.(?:sqlite(?:3)?(?:-wal|-shm)?|db|pem|key|p12|pfx|har|log)$/i;
const patterns=[
 ['private key',/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
 ['Stripe secret',/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/],
 ['webhook secret',/\bwhsec_[A-Za-z0-9]{20,}\b/],
 ['GitHub credential',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
 ['AWS access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
 ['Slack credential',/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
 ['JWT-shaped token',/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/],
 ['personal workstation path',/(?:\/Users\/|\/home\/)[A-Za-z0-9_.-]+\//],
];
function inspect(path,buffer){
 const findings=[];
 if(forbiddenPath.test(path)&&!/(^|\/)\.env\.example$/.test(path))findings.push('runtime or credential path');
 if(buffer.length>10*1024*1024)findings.push('file exceeds 10 MiB publication limit');
 if(!buffer.includes(0))for(const [name,pattern] of patterns)if(pattern.test(buffer.toString('utf8')))findings.push(name);
 return findings;
}
function parseIndex(output){
 return output.split('\0').filter(Boolean).map(record=>{
  const separator=record.indexOf('\t');
  assert(separator>0,'Invalid Git index record');
  const metadata=record.slice(0,separator).match(/^(\d{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])$/);
  assert(metadata,'Invalid Git index metadata');
  const path=record.slice(separator+1);
  assert(path&&!path.startsWith('/')&&!path.split('/').includes('..'),'Invalid tracked path');
  return {mode:metadata[1],oid:metadata[2],stage:Number(metadata[3]),path};
 });
}
if(process.argv.includes('--self-test')){
 assert.deepEqual(inspect('.env.example',Buffer.from('KEY_FILE=/run/secrets/key')),[]);
 assert.deepEqual(inspect('tests/fixture.mjs',Buffer.from("'sk_test_fixture'; 'whsec_fixture'")),[]);
 assert(inspect('data/secrets/password',Buffer.from('anything')).length);
 assert(inspect('nested/.env.production',Buffer.from('anything')).length);
 assert(inspect('backup.sqlite-wal',Buffer.alloc(0)).length);
 assert(inspect('server.js',Buffer.from('sk_'+'test_'+'a'.repeat(24))).length);
 assert(inspect('server.js',Buffer.from('-----BEGIN '+'PRIVATE KEY-----')).length);
 const oid='a'.repeat(40);
 assert.deepEqual(parseIndex(`100644 ${oid} 0\tfile\tname.js\0`),[{mode:'100644',oid,stage:0,path:'file\tname.js'}]);
 assert.equal(parseIndex(`120000 ${oid} 0\tlink\0`)[0].mode,'120000');
 assert.equal(parseIndex(`100644 ${oid} 2\tconflict.js\0`)[0].stage,2);
 assert.throws(()=>parseIndex(`100644 invalid 0\tfile.js\0`));
 assert.throws(()=>parseIndex(`100644 ${oid} 0\t../outside\0`));
 console.log('Publication guard self-tests passed.');
}else{
 const top=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(realpathSync(top),realpathSync(root),'Run inside the independent public repository, not a parent checkout.');
 // Snapshot the index once, then inspect immutable blobs by object ID. Working-tree
 // edits, removals or symlink swaps cannot change the bytes selected for this scan.
 const entries=parseIndex(execFileSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8'}));
 assert(entries.length,'No tracked files to validate. Stage the intended publication first.');
 let failed=0;
 for(const {path,mode,oid,stage} of entries){
  const block=finding=>{console.error(`BLOCK ${JSON.stringify(path)}: ${finding} (value withheld)`);failed++;};
  if(stage!==0){block('unresolved merge entry');continue;}
  if(mode==='120000'){block('symbolic links are not permitted in this export');continue;}
  if(!['100644','100755'].includes(mode)){block('unsupported Git mode; only regular files are permitted');continue;}
  const size=Number(execFileSync('git',['cat-file','-s',oid],{cwd:root,encoding:'utf8'}).trim());
  assert(Number.isSafeInteger(size)&&size>=0,'Invalid Git blob size');
  if(size>10*1024*1024){block('file exceeds 10 MiB publication limit');continue;}
  const blob=execFileSync('git',['cat-file','blob',oid],{cwd:root,maxBuffer:11*1024*1024});
  for(const finding of inspect(path,blob))block(finding);
 }
 if(failed)process.exitCode=1;
 else console.log(`Publication guard passed for ${entries.length} index blobs. Working tree and history were not scanned.`);
}
