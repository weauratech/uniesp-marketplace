import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {oidcProvider} from '../server/auth.mjs';
import {initOutbox,enqueueMail,mailWorker} from '../server/mailer.mjs';
import {DatabaseSync} from 'node:sqlite';
test('OIDC validates signature, issuer, audience, azp, nonce, expiry and userinfo subject',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256'),issuer='https://id.example/realms/uniesp';const jwk=await exportJWK(publicKey);jwk.kid='test';const keys=createLocalJWKSet({keys:[jwk]});
 const mint=(extra={})=>new SignJWT({sub:'stable-sub',nonce:'expected',email_verified:true,azp:'uniesp-web',realm_access:{roles:['admin','forged']},...extra}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(extra.iss||issuer).setAudience(extra.aud||'uniesp-web').setIssuedAt().setExpirationTime(extra.exp||'5m').sign(privateKey);
 let id=await mint(),access=await mint(),sub='stable-sub';const p=oidcProvider({origin:'https://app.example',issuer,secret:'fixture',jwks:keys,fetcher:async(url)=>({ok:true,json:async()=>url.endsWith('openid-configuration')?{issuer,token_endpoint:`${issuer}/protocol/openid-connect/token`,jwks_uri:`${issuer}/protocol/openid-connect/certs`,userinfo_endpoint:`${issuer}/protocol/openid-connect/userinfo`}:url.endsWith('token')?{id_token:id,access_token:access}:{sub,email:'user@example.test',name:'Fixture',email_verified:true}})});
 const flow=p.start('login');assert.equal(new URL(flow.url).searchParams.get('code_challenge_method'),'S256');assert.notEqual(flow.state,flow.nonce);
 const finish=()=>p.finish({code:'fixture',nonce:'expected',verifier:flow.verifier});const u=await finish();assert.deepEqual(u.roles,['admin']);assert.equal(u.sub,'stable-sub');assert.equal(u.emailVerified,true);
 id=await mint({nonce:'wrong'});await assert.rejects(finish);id=await mint({azp:'evil'});await assert.rejects(finish);id=await mint({aud:'evil'});await assert.rejects(finish);id=await mint({iss:'https://evil.example'});await assert.rejects(finish);id=await mint({exp:1});await assert.rejects(finish);id=await mint();sub='other-sub';await assert.rejects(finish);sub='stable-sub';access=await mint({azp:'evil'});await assert.rejects(finish);
});
test('durable outbox deduplicates events, retries bounded, stable Message-ID',async()=>{
 const db=new DatabaseSync(':memory:');initOutbox(db);const e={eventType:'paid',aggregateId:'order',recipient:'a@example.test',payload:{subject:'Teste',text:'Pago em teste'}};enqueueMail(db,e);enqueueMail(db,e);assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,1);let fails=true;const messages=[];const work=mailWorker(db,{transport:{sendMail:async m=>{messages.push(m);if(fails)throw Error('offline');}}});await work();assert.equal(db.prepare('SELECT attempts FROM outbox').get().attempts,1);db.prepare('UPDATE outbox SET nextAt=0').run();fails=false;await work();await work();assert.equal(messages.length,2);assert.equal(messages[0].messageId,messages[1].messageId);assert.equal(db.prepare('SELECT status FROM outbox').get().status,'sent');enqueueMail(db,{...e,aggregateId:'other'});fails=true;for(let i=0;i<6;i++){db.prepare('UPDATE outbox SET nextAt=0').run();await work();}assert.equal(db.prepare("SELECT status FROM outbox WHERE aggregateId='other'").get().status,'failed');db.close();
});
