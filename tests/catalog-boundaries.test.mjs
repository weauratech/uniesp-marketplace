import {authenticate,selections} from './auth-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.mjs';
import {courses} from '../server/catalog.mjs';
test('server catalog availability and monetary bounds gate orders; route aliases absent',async()=>{
 const app=createApp();await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const course=courses[0],previous={priceCents:course.priceCents,available:course.available};
 try{
  const session=await fetch(base+'/session'),cookie=session.headers.get('set-cookie').split(';')[0],csrf=(await session.json()).csrfToken;
  authenticate(app,cookie);const headers={cookie,origin:'http://127.0.0.1:5176','x-csrf-token':csrf,'content-type':'application/json'};
  const write=(path,body,method='POST')=>fetch(base+path,{method,headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify(body)});
  await write('/cart',{courseIds:[course.id]},'PUT');
  for(const variant of [{available:false},{available:true,priceCents:-1},{priceCents:1.5},{priceCents:100000001}]){
   Object.assign(course,variant);const cart=await(await fetch(base+'/cart',{headers:{cookie}})).json();
   assert.equal((await write('/orders',{cartRevision:cart.revision})).status,422);
  }
  Object.assign(course,previous);const cart=await(await fetch(base+'/cart',{headers:{cookie}})).json();
  const order=await(await write('/orders',{cartRevision:cart.revision,selections:selections(app,[course.id])})).json();
  assert.equal((await fetch(base+'/demo/orders/'+order.id,{headers:{cookie}})).status,404);
  assert.equal((await write('/demo/orders/'+order.id+'/checkout',{})).status,404);
 }finally{Object.assign(course,previous);await app.close();}
});
