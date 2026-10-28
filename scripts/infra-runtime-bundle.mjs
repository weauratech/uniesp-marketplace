// Run after host npm ci + web build; include the complete locked production graph.
import {cp,mkdir,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const dest='.local-build/runtime';
await rm(dest,{recursive:true,force:true});await mkdir(dest,{recursive:true});
for(const file of ['package.json','package-lock.json']) await cp(file,`${dest}/${file}`);
const install=spawnSync('npm',['ci','--prefix',dest,'--omit=dev','--offline','--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit'});
if(install.status!==0) throw Error('Offline runtime install failed; populate host npm cache with npm ci first.');
async function check(path) {
 for(const item of await readdir(path,{withFileTypes:true})) {
  const child=`${path}/${item.name}`;
  if(item.isDirectory()) await check(child);
  else if(item.name.endsWith('.node')) throw Error(`Native dependency requires Linux build: ${child}`);
 }
}
await check(`${dest}/node_modules`);
await rm('.local-build/node_modules',{recursive:true,force:true});
await cp(`${dest}/node_modules`,'.local-build/node_modules',{recursive:true});
await cp('web/dist','.local-build/dist',{recursive:true,force:true});
console.log('Offline production dependencies and web build bundled; no native Node binaries found.');
