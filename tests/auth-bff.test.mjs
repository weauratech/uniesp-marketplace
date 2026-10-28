import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {createApp} from '../server/app.mjs';
const origin='http://127.0.0.1:5176';
test('BFF binds callback to session, consumes state, rotates cookie, stable sub ownership and logout',async()=>{
 let reject=false;const identity={issuer:'https://id.test',sub:'sub-a',displayName:'Fixture',email:'same@example.test',emailVerified:true,roles:['aluno'],expires:Date.now()+3600000,idToken:'server-only'};
 const oidc={start:()=>({state:randomBytes(32).toString('hex'),nonce:'nonce',verifier:'verifier',url:'https://id.test/auth'}),finish:async f=>{assert.equal(f.verifier,'verifier');if(reject)throw Error();return {...identity};},logout:()=> 'https://id.test/logout'};
 const app=createApp({oidc});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}/api`;let cookie,csrf;
 const boot=async()=>{const r=await fetch(base+'/session');cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrfToken;};
 const req=(p,body,headers={})=>fetch(base+p,{method:'POST',headers:{cookie,origin,'x-csrf-token':csrf,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const login=async()=>{const r=await req('/auth/login',{intent:'login',returnTo:'/area-aluno'});assert.equal(r.status,200);return app.db.prepare('SELECT * FROM auth_flows ORDER BY rowid DESC LIMIT 1').get();};
 const cb=(f,c=cookie)=>fetch(base+`/auth/callback?state=${f.state}&code=fixture`,{headers:{cookie:c},redirect:'manual'});
 try{await boot();const guest=cookie;
 assert.equal((await req('/orders',{})).status,401);assert.equal((await req('/auth/login',{intent:'login',returnTo:'/area-aluno'},{origin:'https://evil.test'})).status,403);assert.equal((await req('/auth/login',{intent:'login',returnTo:'/area-aluno'},{'x-csrf-token':'wrong'})).status,403);
 await fetch(base+'/cart',{method:'PUT',headers:{cookie,origin,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify({courseIds:['cybersecurity']})});
 let flow=await login();assert.equal((await cb(flow,'uniesp_session='+randomBytes(32).toString('hex'))).status,400);let r=await cb(flow);assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];assert.notEqual(cookie,guest);assert.equal((await cb(flow)).status,400);assert.equal((await fetch(base+'/auth/me',{headers:{cookie:guest}})).status,401);
 const bootstrap=await (await fetch(base+'/session',{headers:{cookie}})).json();csrf=bootstrap.csrfToken;const me=await (await fetch(base+'/auth/me',{headers:{cookie}})).json();assert.equal(me.user.email,identity.email);assert.doesNotMatch(JSON.stringify(me),/server-only|idToken|access_token/);assert.equal((await (await fetch(base+'/cart',{headers:{cookie}})).json()).items.length,0);assert.equal((await req('/auth/cart/import',{})).status,200);assert.equal((await (await fetch(base+'/cart',{headers:{cookie}})).json()).items.length,1);
 assert.equal(bootstrap.pendingCartAvailable,true);assert.equal((await req('/auth/cart/import',{})).status,200);assert.equal((await (await fetch(base+'/cart',{headers:{cookie}})).json()).items.length,1);assert.equal((await (await fetch(base+'/session',{headers:{cookie}})).json()).pendingCartAvailable,false);
 const uid=me.user.id;assert.equal((await req('/admin/cohorts',{roles:['admin']})).status,403);
 const ownerId=createHash('sha256').update(cookie.split('=')[1]).digest('hex');app.db.prepare('INSERT INTO orders(id,owner,body,userId) VALUES(?,?,?,?)').run('owned',ownerId,JSON.stringify({id:'owned',userId:uid}),uid);
 // Legacy cookie-owned order cannot be claimed by login.
 const oldId=createHash('sha256').update(guest.split('=')[1]).digest('hex');app.db.prepare('INSERT INTO orders(id,owner,body) VALUES(?,?,?)').run('legacy',oldId,JSON.stringify({id:'legacy'}));assert.equal((await fetch(base+'/orders/legacy',{headers:{cookie}})).status,404);
 const logout=await req('/auth/logout',{});assert.equal(logout.status,200);const logoutBody=await logout.json();assert.doesNotMatch(JSON.stringify(logoutBody),/server-only/);const complete=await fetch(new URL(logoutBody.redirectUrl,base),{redirect:'manual'});assert.equal(complete.status,303);assert.equal(complete.headers.get('location'),'https://id.test/logout');assert.equal((await fetch(new URL(logoutBody.redirectUrl,base),{redirect:'manual'})).status,400);assert.equal((await fetch(base+'/auth/me',{headers:{cookie}})).status,401);
 await boot();flow=await login();identity.email='changed@example.test';r=await cb(flow);cookie=r.headers.get('set-cookie').split(';')[0];const again=await (await fetch(base+'/auth/me',{headers:{cookie}})).json();assert.equal(again.user.id,uid);assert.equal((await fetch(base+'/orders/owned',{headers:{cookie}})).status,200);
 await boot();identity.sub='sub-b';flow=await login();r=await cb(flow);cookie=r.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/orders/owned',{headers:{cookie}})).status,404);
 await boot();identity.emailVerified=false;flow=await login();r=await cb(flow);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await (await fetch(base+'/session',{headers:{cookie}})).json()).csrfToken;assert.equal((await req('/orders',{})).status,403);
 await boot();flow=await login();reject=true;assert.equal((await cb(flow)).status,400);reject=false;assert.equal((await cb(flow)).status,400);
 }finally{await app.close();}
});
