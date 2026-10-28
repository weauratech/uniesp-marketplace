import {mkdir,writeFile,chmod,statfs,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const disk=await statfs('.');
const {spawnSync}=await import('node:child_process');
const installed=['quay.io/keycloak/keycloak:26.8.1','postgres:18.6-alpine','axllent/mailpit:v1.32.0'].every(image=>spawnSync('docker',['image','inspect',image],{stdio:'ignore'}).status===0);
const minimumGiB=installed?3:10;
if(disk.bavail*disk.bsize < minimumGiB*1024**3) throw Error(`Infra requires ${minimumGiB} GiB free for this setup; no images were pruned.`);
await mkdir('data/secrets',{recursive:true,mode:0o700});
await chmod('data/secrets',0o700);
for(const name of ['identity-db-password','keycloak-admin-password','oidc-client-secret','marketplace-admin-password']) {
 const path=`data/secrets/${name}`;
 try {await access(path);} catch {await writeFile(path,randomBytes(32).toString('base64url'),{mode:0o600,flag:'wx'});}
 await chmod(path,0o600);
}
await writeFile('.env.infra','# Local identity state; all credentials live in ignored data/secrets files.\nOIDC_ISSUER=http://127.0.0.1:8088/realms/uniesp\nOIDC_INTERNAL_URL=http://keycloak:8080/realms/uniesp\nOIDC_CLIENT_ID=uniesp-web\n',{mode:0o600});
console.log('Infra preflight passed; credential files prepared (values withheld).');
