import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {stripeAdapter} from '../server/stripe.mjs';
import {authenticate,selections} from './auth-fixtures.mjs';
test('authenticated reconciliation retrieves server-owned attempt and settles atomic enrollment/outbox',async()=>{
 let lookup,reads=0,requestedId;const adapter=stripeAdapter({secret:'rk_test_fixture',webhookSecret:'whsec_fixture',origin:'http://127.0.0.1:5176',client:{checkout:{sessions:{create:async p=>{lookup={id:'cs_test_reconcile',livemode:false,status:'complete',payment_status:'paid',mode:'payment',metadata:p.metadata,client_reference_id:p.client_reference_id,amount_total:10000,currency:'brl',payment_intent:'pi_reconcile'};return {...lookup,url:'https://checkout.stripe.com/c/pay/cs_test_reconcile',expires_at:Math.floor(Date.now()/1000)+3600};},retrieve:async id=>{reads++;requestedId=id;return lookup;}}}}});
 const app=createApp({adapter,mode:'test'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 try{let r=await fetch(base+'/session');const cookie=r.headers.get('set-cookie').split(';')[0],csrf=(await r.json()).csrfToken;authenticate(app,cookie);const headers={cookie,origin:'http://127.0.0.1:5176','x-csrf-token':csrf,'content-type':'application/json'};const post=(p,b={},method='POST')=>fetch(base+p,{method,headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify(b)});const c=await (await post('/cart',{courseIds:['cybersecurity']},'PUT')).json();const o=await (await post('/orders',{cartRevision:c.revision,selections:selections(app,['cybersecurity'])})).json();await post('/orders/'+o.id+'/checkout');
 r=await fetch(base+'/orders/'+o.id+'?paid=true',{headers:{cookie}});assert.equal((await r.json()).status,'pending');assert.equal(reads,0);
 r=await fetch(base+'/orders/'+o.id+'/reconcile',{method:'POST',headers:{...headers,'x-csrf-token':'invalid'},body:'{}'});assert.equal(r.status,403);assert.equal(reads,0);
 r=await post('/orders/'+o.id+'/reconcile');assert.equal(r.status,200);assert.equal((await r.json()).status,'paid');assert.equal(requestedId,'cs_test_reconcile');await post('/orders/'+o.id+'/reconcile');assert.equal(app.db.prepare('SELECT count(*) n FROM academic_enrollments').get().n,1);assert.equal(app.db.prepare('SELECT count(*) n FROM outbox').get().n,3);
 authenticate(app,cookie);assert.equal((await post('/orders/'+o.id+'/reconcile')).status,404);
 }finally{await app.close();}
});
