// Supplemental publication guard. This is not a replacement for a secret scanner.
import {execFileSync} from 'node:child_process';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,sep} from 'node:path';
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
if(process.argv.includes('--self-test')){
 assert.deepEqual(inspect('.env.example',Buffer.from('KEY_FILE=/run/secrets/key')),[]);
 assert.deepEqual(inspect('tests/fixture.mjs',Buffer.from("'sk_test_fixture'; 'whsec_fixture'")),[]);
 assert(inspect('data/secrets/password',Buffer.from('anything')).length);
 assert(inspect('nested/.env.production',Buffer.from('anything')).length);
 assert(inspect('backup.sqlite-wal',Buffer.alloc(0)).length);
 assert(inspect('server.js',Buffer.from('sk_'+'test_'+'a'.repeat(24))).length);
 assert(inspect('server.js',Buffer.from('-----BEGIN '+'PRIVATE KEY-----')).length);
 console.log('Publication guard self-tests passed.');
}else{
 const top=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8'}).trim();
 assert.equal(realpathSync(top),realpathSync(root),'Run inside the independent public repository, not a parent checkout.');
 const paths=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 assert(paths.length,'No tracked files to validate. Stage the intended publication first.');
 let failed=0;
 for(const path of paths){
  const absolute=resolve(root,path),rel=relative(root,absolute);
  assert(!rel.startsWith('..'+sep)&&rel!=='..','Tracked path escapes repository');
  if(lstatSync(absolute).isSymbolicLink()){console.error(`BLOCK ${path}: symbolic links are not permitted in this export`);failed++;continue;}
  for(const finding of inspect(path,readFileSync(absolute))){console.error(`BLOCK ${path}: ${finding} (value withheld)`);failed++;}
 }
 if(failed)process.exitCode=1;
 else console.log(`Publication guard passed for ${paths.length} tracked files. No history scan performed.`);
}
