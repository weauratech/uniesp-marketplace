import {provisionIdentity} from './provisioning-identity.mjs';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const origin='http://127.0.0.1:8088', realm='uniesp';
const secret=async name=>(await readFile(`data/secrets/${name}`,'utf8')).trim();
// Bootstrap credentials and tokens never appear in argv or output.
const auth=await fetch(`${origin}/realms/master/protocol/openid-connect/token`,{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'bootstrap-admin',password:await secret('keycloak-admin-password')})});
if(!auth.ok) throw Error(`Bootstrap authentication failed (${auth.status})`);
const {access_token}=await auth.json();
async function api(path,method='GET',body,allowed=[]) {
 const res=await fetch(`${origin}/admin/realms${path}`,{method,headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!res.ok&&!allowed.includes(res.status)) throw Error(`Identity admin ${method} ${path.split('?')[0]} failed (${res.status}); response withheld`);
 if(method==='POST'&&path===`/${realm}/users`&&res.status===201){
  const location=new URL(res.headers.get('location')||'',origin);
  const prefix=`/admin/realms/${realm}/users/`;
  if(location.origin!==origin||!location.pathname.startsWith(prefix)||location.pathname.slice(prefix.length).includes('/')||!location.pathname.slice(prefix.length))throw Error('Invalid created identity location');
  return {id:decodeURIComponent(location.pathname.slice(prefix.length))};
 }
 return res.status===204||res.status===404?null:res.headers.get('content-type')?.includes('json')?res.json():null;
}
const config={realm,enabled:true,registrationAllowed:true,registrationEmailAsUsername:true,loginWithEmailAllowed:true,duplicateEmailsAllowed:false,verifyEmail:true,resetPasswordAllowed:true,editUsernameAllowed:false,sslRequired:'none',bruteForceProtected:true,passwordPolicy:'length(12)',smtpServer:{host:'mailpit',port:'1025',from:'no-reply@uniesp.local',auth:'false',ssl:'false',starttls:'false'}};
const exists=await api(`/${realm}`,'GET',undefined,[404]);
if(exists) await api(`/${realm}`,'PUT',config); else await api('','POST',config);
for(const name of ['aluno','professor','admin']) {
 if(!await api(`/${realm}/roles/${name}`,'GET',undefined,[404])) await api(`/${realm}/roles`,'POST',{name});
}
const defaultRole=await api(`/${realm}/roles/default-roles-${realm}`);
const composites=await api(`/${realm}/roles-by-id/${defaultRole.id}/composites`);
const privileged=composites.filter(r=>['admin','professor'].includes(r.name));
if(privileged.length) await api(`/${realm}/roles-by-id/${defaultRole.id}/composites`,'DELETE',privileged);
await api(`/${realm}/roles-by-id/${defaultRole.id}/composites`,'POST',[await api(`/${realm}/roles/aluno`)]);
const client={clientId:'uniesp-web',name:'UNIESP marketplace',enabled:true,protocol:'openid-connect',publicClient:false,secret:await secret('oidc-client-secret'),standardFlowEnabled:true,directAccessGrantsEnabled:false,implicitFlowEnabled:false,serviceAccountsEnabled:false,redirectUris:['http://127.0.0.1:5177/api/auth/callback'],webOrigins:['http://127.0.0.1:5177'],attributes:{'pkce.code.challenge.method':'S256','post.logout.redirect.uris':'http://127.0.0.1:5177'}};
const clients=await api(`/${realm}/clients?clientId=uniesp-web`);
if(clients.length) await api(`/${realm}/clients/${clients[0].id}`,'PUT',client); else await api(`/${realm}/clients`,'POST',client);
const appClient=(await api(`/${realm}/clients?clientId=uniesp-web`))[0];
const mapper={name:'uniesp-web-audience',protocol:'openid-connect',protocolMapper:'oidc-audience-mapper',consentRequired:false,config:{'included.client.audience':'uniesp-web','id.token.claim':'false','access.token.claim':'true'}};
const mappers=await api(`/${realm}/clients/${appClient.id}/protocol-mappers/models`);
const current=mappers.find(m=>m.name===mapper.name);
if(current)await api(`/${realm}/clients/${appClient.id}/protocol-mappers/models/${current.id}`,'PUT',{...mapper,id:current.id});
else await api(`/${realm}/clients/${appClient.id}/protocol-mappers/models`,'POST',mapper);
// Only the local bootstrap provisions the application admin role.
const username='admin@uniesp.local';
await provisionIdentity({api,realm,role:'admin',account:{username,email:username,emailVerified:true,enabled:true,firstName:'Local',lastName:'Administrator',credentials:[{type:'password',value:await secret('marketplace-admin-password'),temporary:false}]}});
if(process.argv.includes('--demo-accounts')) {
 const path='data/secrets/demo-accounts.json';
 let accounts;
 try {accounts=JSON.parse(await readFile(path,'utf8'));} catch(error) {
  if(error.code!=='ENOENT') throw error;
  accounts=Object.fromEntries(['aluno','professor','admin'].map(role=>[role,{email:`${role}@uniesp.test`,password:randomBytes(32).toString('base64url')}]));
  await writeFile(path,JSON.stringify(accounts,null,2),{mode:0o600,flag:'wx'});
 }
 await chmod(path,0o600);
 for(const [role,account] of Object.entries(accounts)) {
  assert(['aluno','professor','admin'].includes(role));assert(account.email===`${role}@uniesp.test`);
  await provisionIdentity({api,realm,role,account:{username:account.email,email:account.email,emailVerified:true,enabled:true,firstName:role,lastName:'Demonstração',credentials:[{type:'password',value:account.password,temporary:false}]}});
 }
 console.log('Local demonstration accounts provisioned; credentials withheld in mode-0600 JSON file.');
}
const discovery=await (await fetch(`${origin}/realms/${realm}/.well-known/openid-configuration`)).json();
assert.equal(discovery.issuer,`${origin}/realms/${realm}`);
const configured=(await api(`/${realm}/clients?clientId=uniesp-web`))[0];
assert.equal(configured.directAccessGrantsEnabled,false);assert.equal(configured.implicitFlowEnabled,false);assert.equal(configured.attributes['pkce.code.challenge.method'],'S256');
assert.deepEqual(configured.redirectUris,client.redirectUris);
const realmState=await api(`/${realm}`);
assert.equal(realmState.smtpServer.host,'mailpit');
assert.equal(realmState.registrationEmailAsUsername,true);assert.equal(realmState.verifyEmail,true);assert.equal(realmState.resetPasswordAllowed,true);
assert.equal(configured.publicClient,false);assert.equal(configured.serviceAccountsEnabled,false);
assert.equal(configured.attributes['post.logout.redirect.uris'],'http://127.0.0.1:5177');
const defaults=await api(`/${realm}/roles-by-id/${defaultRole.id}/composites`);
assert(defaults.some(r=>r.name==='aluno'));assert(!defaults.some(r=>['admin','professor'].includes(r.name)));
if(process.argv.includes('--verify-smtp')) {
 const email=`infra-fixture-${Date.now()}@example.invalid`;
 await api(`/${realm}/users`,'POST',{username:email,email,enabled:true});
 const [fixture]=await api(`/${realm}/users?username=${encodeURIComponent(email)}&exact=true`);
 try {
  const roles=await api(`/${realm}/users/${fixture.id}/role-mappings/realm/composite`);
  assert(roles.some(r=>r.name==='aluno'));assert(!roles.some(r=>['admin','professor'].includes(r.name)));
  await api(`/${realm}/users/${fixture.id}/execute-actions-email?client_id=uniesp-web&redirect_uri=${encodeURIComponent(client.redirectUris[0])}`,'PUT',['VERIFY_EMAIL']);
  let received=false;
  for(let i=0;i<20;i++) {
   const messages=await (await fetch('http://127.0.0.1:8025/api/v1/messages')).json();
   if(messages.messages?.some(m=>m.To?.some(to=>to.Address===email))) {received=true;break;}
   await new Promise(r=>setTimeout(r,500));
  }
  assert(received,'Mailpit did not receive the synthetic verification fixture');
 } finally {await api(`/${realm}/users/${fixture.id}`,'DELETE');}
 console.log('SMTP verification fixture received by Mailpit; temporary identity removed.');
}
console.log('Identity configured and verified: discovery issuer, realm roles/default, confidential client, PKCE, exact redirect, SMTP. No credential values emitted.');
