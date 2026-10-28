import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {oidcProvider} from '../server/auth.mjs';
import {authenticate,selections} from './auth-fixtures.mjs';
test('recovery starts login without password-update action',()=>{const u=new URL(oidcProvider({origin:'http://localhost',issuer:'https://id.test'}).start('reset').url);assert.equal(u.pathname,'/protocol/openid-connect/auth');assert.equal(u.searchParams.has('kc_action'),false);assert.equal(u.searchParams.get('code_challenge_method'),'S256');});
for(const paid of [false,true])test(`cancel is locked, replay safe and reconciles paid=${paid}`,async()=>{
 let release,started;const ready=new Promise(r=>started=r);let expires=0;let orderId,attemptId;
 const adapter={createCheckout:async(o,id)=>{orderId=o.id;attemptId=id;return {providerSessionId:'cs_test_cancel',url:'https://checkout.stripe.com/c/pay/test',expiresAt:new Date(Date.now()+3600000).toISOString()};},fetchPayment:async()=>({id:'cs_test_cancel',livemode:false,client_reference_id:orderId,metadata:{orderId,attemptId},status:expires?(paid?'complete':'expired'):'open',payment_intent:'pi_cancel_fixture'}),expireCheckout:async()=>{expires++;started();await new Promise(r=>release=r);},valid:v=>paid&&v.status==='complete'};
 const app=createApp({mode:'test',adapter});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 try{const boot=await fetch(base+'/session');const cookie=boot.headers.get('set-cookie').split(';')[0],csrf=(await boot.json()).csrfToken;authenticate(app,cookie);const post=(path,body={},key=randomUUID(),method='POST')=>fetch(base+path,{method,headers:{cookie,origin:'http://127.0.0.1:5176','x-csrf-token':csrf,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
 const c=await (await post('/cart',{courseIds:['cybersecurity']},randomUUID(),'PUT')).json();const o=await (await post('/orders',{cartRevision:c.revision,selections:selections(app,['cybersecurity'])})).json();assert.ok(o.id);await post(`/orders/${o.id}/checkout`);const key=randomUUID();const pending=post(`/orders/${o.id}/cancel`,{},key);await ready;assert.equal((await post(`/orders/${o.id}/checkout`)).status,409);release();const result=await pending;assert.equal(result.status,200);assert.equal((await result.json()).status,paid?'paid':'cancelled');assert.equal((await post(`/orders/${o.id}/cancel`,{},key)).status,200);assert.equal(expires,1);assert.equal(app.db.prepare('SELECT count(*) n FROM academic_reservations').get().n,0);assert.equal(app.db.prepare('SELECT count(*) n FROM academic_enrollments').get().n,paid?1:0);
 }finally{await app.close();}
});
