import {authenticate,selections} from './auth-fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {randomUUID} from 'node:crypto';
import {stripeAdapter} from '../server/stripe.mjs';
import {createApp} from '../server/app.mjs';
test('official SDK signature fixtures, authoritative lookup and replay',async()=>{
 const sdk=new Stripe('sk_test_fixture'),secret='whsec_fixture';let lookup,creates=0;
 const adapter=stripeAdapter({secret:'sk_test_fixture',webhookSecret:secret,origin:'http://127.0.0.1:5176',client:{webhooks:sdk.webhooks,checkout:{sessions:{create:async(input)=>{assert.equal(Object.hasOwn(input,'payment_method_types'),false);creates++;lookup={id:'cs_test_fixture',livemode:false,mode:'payment',status:'complete',payment_status:'paid',client_reference_id:input.client_reference_id,metadata:input.metadata,amount_total:input.line_items[0].price_data.unit_amount,currency:'brl',payment_intent:'pi_fixture'};return {...lookup,url:'https://checkout.stripe.com/c/pay/cs_test_fixture',expires_at:Math.floor(Date.now()/1000)+3600};},retrieve:async()=>({...lookup})}}}});
 const app=createApp({mode:'test',adapter});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 try{
 const session=await fetch(base+'/session'),cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrfToken;
 authenticate(app,cookie);const headers={cookie,origin:'http://127.0.0.1:5176','x-csrf-token':csrf,'content-type':'application/json'};
 const post=(path,body={},method='POST')=>fetch(base+path,{method,headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify(body)});
 const cart=await (await post('/cart',{courseIds:['cybersecurity']},'PUT')).json();const order=await (await post('/orders',{cartRevision:cart.revision,selections:selections(app,['cybersecurity'])})).json();
 assert.equal(order.paymentMode,'test');const checkout=await (await post('/orders/'+order.id+'/checkout')).json();assert.match(checkout.redirectUrl,/checkout.stripe.com/);assert.equal(creates,1);assert.equal((await (await fetch(base+'/orders/'+order.id+'?paid=true',{headers:{cookie}})).json()).status,'pending');lookup.amount_total=1;assert.equal((await (await post('/orders/'+order.id+'/reconcile')).json()).status,'pending');lookup.amount_total=10000;
 const attempt=app.db.prepare('SELECT * FROM attempts WHERE orderId=?').get(order.id);const expired={...JSON.parse(attempt.body),expiresAt:new Date(0).toISOString()};app.db.prepare('UPDATE attempts SET body=? WHERE id=?').run(JSON.stringify(expired),attempt.id);
 lookup.status='open';assert.equal((await post('/orders/'+order.id+'/checkout')).status,409);lookup.status='expired';assert.equal((await post('/orders/'+order.id+'/checkout')).status,200);assert.equal(creates,2);
 const replayKey=randomUUID();const replayCheckout=()=>fetch(base+'/orders/'+order.id+'/checkout',{method:'POST',headers:{...headers,'idempotency-key':replayKey},body:'{}'});const originalCheckout=await (await replayCheckout()).json();
 const event={id:'evt_fixture',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_fixture'}}};
 const hook=async(e=event,bad=false)=>{const raw=JSON.stringify(e);const sig=sdk.webhooks.generateTestHeaderString({payload:raw,secret:bad?'wrong':secret});return fetch(base+'/webhooks/stripe',{method:'POST',headers:{'stripe-signature':sig},body:raw});};
 assert.equal((await hook(event,true)).status,400);
 lookup.amount_total=1;assert.equal((await hook()).status,200);assert.equal(JSON.parse(app.db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body).status,'pending');
 lookup.amount_total=10000;lookup.currency='usd';await hook();assert.equal(app.db.prepare('SELECT count(*) n FROM events').get().n,0);lookup.currency='brl';
 lookup.metadata.orderId='wrong';await hook();assert.equal(app.db.prepare('SELECT count(*) n FROM events').get().n,0);lookup.metadata.orderId=order.id;
 assert.equal((await hook({...event,livemode:true})).status,400);
 const reservation=app.db.prepare('SELECT * FROM academic_reservations WHERE orderId=?').get(order.id);app.db.prepare('DELETE FROM academic_reservations WHERE orderId=?').run(order.id);assert.equal((await hook()).status,503);assert.equal(app.db.prepare('SELECT count(*) n FROM events').get().n,0);assert.equal(JSON.parse(app.db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body).status,'pending');app.db.prepare('INSERT INTO academic_reservations VALUES(?,?,?,?,?)').run(reservation.orderId,reservation.courseId,reservation.cohortId,reservation.userId,reservation.body);
 assert.equal((await hook()).status,200);assert.equal((await hook()).status,200);assert.equal((await hook({...event,id:'evt_second'})).status,200);
 assert.deepEqual(await (await replayCheckout()).json(),originalCheckout);assert.equal(app.db.prepare('SELECT count(*) n FROM events').get().n,1);assert.equal(JSON.parse(app.db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body).status,'paid');
 assert.equal(app.db.prepare('SELECT count(*) n FROM academic_enrollments').get().n,1);assert.equal(app.db.prepare('SELECT count(*) n FROM academic_reservations').get().n,0);assert.equal(app.db.prepare('SELECT count(*) n FROM outbox').get().n,3);assert.equal((await (await post('/orders/'+order.id+'/reconcile')).json()).status,'paid');assert.equal(app.db.prepare('SELECT count(*) n FROM academic_enrollments').get().n,1);
 }finally{await app.close();}
});
test('reject live keys',()=>{assert.throws(()=>stripeAdapter({secret:'sk_live_fixture',webhookSecret:'whsec_fixture'}));});
