import {open,writeFile,rename,unlink,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';

// Email is a lookup hint, never authority to adopt an existing privileged account.
export async function provisionIdentity({api,realm,account,role,registryPath='data/secrets/provisioned-identities.json'}) {
 const lock=await open(`${registryPath}.lock`,'wx',0o600);
 let temporary;
 try {
  let registry={version:1,users:{}};
  try {
   const handle=await open(registryPath,constants.O_RDONLY|constants.O_NOFOLLOW);
   try {if(!(await handle.stat()).isFile())throw Error('Invalid identity registry');registry=JSON.parse(await handle.readFile('utf8'));} finally {await handle.close();}
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  if(registry.version!==1||!registry.users||Array.isArray(registry.users)||typeof registry.users!=='object')throw Error('Invalid identity registry');
  const matches=await api(`/${realm}/users?username=${encodeURIComponent(account.username)}&exact=true`);
  const known=Object.hasOwn(registry.users,account.username)?registry.users[account.username]:undefined;
  let id;
  if(known!==undefined) {
   if(typeof known!=='string'||!known||matches.length!==1||matches[0].id!==known)throw Error('Provisioned identity mismatch; manual local recovery required');
   id=known;
  } else {
   if(matches.length)throw Error('Reserved identity already exists; refusing privilege assignment');
   // The created resource ID must come from the POST response, not an email re-query.
   const created=await api(`/${realm}/users`,'POST',account);
   if(typeof created?.id!=='string'||!created.id)throw Error('Created identity ID missing; refusing privilege assignment');
   id=created.id;registry.users[account.username]=id;
   temporary=`${registryPath}.${randomUUID()}.tmp`;
   await writeFile(temporary,JSON.stringify(registry,null,2),{mode:0o600,flag:'wx'});
   await rename(temporary,registryPath);temporary=undefined;
  }
  await chmod(registryPath,0o600);
  await api(`/${realm}/users/${encodeURIComponent(id)}/role-mappings/realm`,'POST',[await api(`/${realm}/roles/${role}`)]);
  return id;
 } finally {
  if(temporary)await unlink(temporary).catch(()=>{});
  await lock.close();await unlink(`${registryPath}.lock`);
 }
}
