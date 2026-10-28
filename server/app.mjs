import http from 'node:http';
import {oidcProvider} from './auth.mjs';
import {initOutbox,enqueueMail,mailWorker} from './mailer.mjs';
import {createAcademic} from './academic.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {courses} from './catalog.mjs';
import {answer} from './chat.mjs';
import {stripeAdapter} from './stripe.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const equal=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createApp({dbPath=':memory:',origin='http://127.0.0.1:5176',mode='demo',oidc,mail,webDir=resolve(process.env.WEB_DIST||'web/dist'),adapter}={}) {
 webDir=resolve(webDir);const originUrl=new URL(origin);if(originUrl.origin!==origin||originUrl.protocol!=='https:'&&!(originUrl.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(originUrl.hostname)))throw Error('Invalid app origin');
 if(!['demo','disabled','test'].includes(mode)) throw new Error('Unsupported payment mode');
 if(Object.entries(process.env).some(([k,v])=>/STRIPE.*KEY/.test(k)&&/^(sk|rk)_live_/.test(v))) throw new Error('Live keys forbidden');
 if(mode==='test'&&!adapter&&(process.env.STRIPE_SECRET_KEY||process.env.STRIPE_SECRET_KEY_FILE)&&(process.env.STRIPE_WEBHOOK_SECRET||process.env.STRIPE_WEBHOOK_SECRET_FILE))adapter=stripeAdapter({origin});
 const enabled=mode==='demo'||mode==='test'&&!!adapter;
 const payment={mode:mode==='test'&&!adapter?'disabled':mode,provider:adapter&&mode==='test'?'stripe':'none',checkoutEnabled:enabled,reason:enabled?null:'Provedor de teste não configurado e validado.'};
 const db=new DatabaseSync(dbPath); db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL,cart TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES sessions(id),body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS idem(owner TEXT NOT NULL REFERENCES sessions(id),route TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,status INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(owner,route,key));`);
 db.exec(`CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,orderId TEXT UNIQUE NOT NULL,sessionId TEXT UNIQUE,body TEXT); CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,paymentId TEXT UNIQUE);`);
 if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='catalogHash'))db.exec("ALTER TABLE sessions ADD COLUMN catalogHash TEXT NOT NULL DEFAULT ''");
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,sub TEXT NOT NULL,displayName TEXT,email TEXT,emailVerified INTEGER,roles TEXT,UNIQUE(issuer,sub)); CREATE TABLE IF NOT EXISTS auth_flows(state TEXT PRIMARY KEY,sessionId TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);`);
 for(const [table,column,type] of [['sessions','userId','TEXT'],['sessions','idToken','TEXT'],['sessions','pendingCart',"TEXT DEFAULT '[]'"],['orders','userId','TEXT']])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
 db.exec('CREATE TABLE IF NOT EXISTS logout_flows(ticket TEXT PRIMARY KEY,idToken TEXT,expires INTEGER NOT NULL)');
 initOutbox(db);const academic=createAcademic({db,courses});oidc=oidc===undefined?oidcProvider({origin}):oidc;
 const flushMail=mailWorker(db,mail);const mailTimer=setInterval(()=>flushMail().catch(()=>{}),2000);mailTimer.unref();
 const notify=(o,type)=>{const u=db.prepare('SELECT email FROM users WHERE id=?').get(o.userId);if(u)enqueueMail(db,{eventType:type,aggregateId:o.id,recipient:u.email,payload:{subject:`UNIESP — pedido ${o.status}`,text:`Pedido ${o.id}: ${o.status}. Pagamento de teste, sem validade institucional.`}});};
 const settle=(input)=>{const o=JSON.parse(db.prepare('SELECT body FROM orders WHERE id=?').get(input.id).body);if(o.status!=='pending')return;const paid={...o,status:'paid',updatedAt:new Date().toISOString()};db.prepare('UPDATE orders SET body=? WHERE id=?').run(JSON.stringify(paid),o.id);academic.fulfillPaidOrder({orderId:o.id,userId:o.userId,now:new Date().toISOString()});notify(paid,'paid');notify(paid,'orderupdate');};
 const settlePayment=(o,payment,eventId)=>{if(db.prepare('SELECT id FROM events WHERE id=? OR paymentId=?').get(eventId,payment.payment_intent))return;db.prepare('INSERT INTO events(id,paymentId) VALUES(?,?)').run(eventId,payment.payment_intent);settle(o);};
 const orderLocks=new Set();
 const lockOrder=id=>{if(orderLocks.has(id))fail(409,'ORDER_BUSY');orderLocks.add(id);};
 const cancelLocal=o=>{const fresh=JSON.parse(db.prepare('SELECT body FROM orders WHERE id=?').get(o.id).body);if(fresh.status!=='pending')return fresh;const cancelled={...fresh,status:'cancelled',updatedAt:new Date().toISOString()};academic.releaseOrder({orderId:o.id});db.prepare('UPDATE orders SET body=? WHERE id=?').run(JSON.stringify(cancelled),o.id);notify(cancelled,'orderupdate');return cancelled;};
 const verifyAttempt=(v,o,a)=>v.livemode===false&&v.id===a.sessionId&&v.client_reference_id===o.id&&v.metadata?.orderId===o.id&&v.metadata?.attemptId===a.id;
 const inspectCancellation=async(o,expire)=>{let a=db.prepare('SELECT * FROM attempts WHERE orderId=?').get(o.id);if(!a)return null;
 // A failed create may still have created a provider session: replay its original key first.
 if(!a.sessionId){const c=await adapter.createCheckout(o,a.id);db.prepare('UPDATE attempts SET sessionId=?,body=? WHERE id=?').run(c.providerSessionId,JSON.stringify(c),a.id);a={...a,sessionId:c.providerSessionId};}
 let v=await adapter.fetchPayment({data:{object:{id:a.sessionId}}});if(!verifyAttempt(v,o,a))throw Error('PAYMENT_INVALID');
 if(v.status==='open'&&expire){try{await adapter.expireCheckout(a.sessionId,`cancel:${a.id}`);}catch{/* Payment may have won the race; retrieve is authoritative. */}v=await adapter.fetchPayment({data:{object:{id:a.sessionId}}});if(!verifyAttempt(v,o,a))throw Error('PAYMENT_INVALID');}
 if(adapter.valid(v,o,a))return {paid:v,attempt:a};if(v.status!=='expired')throw Error('PAYMENT_NOT_EXPIRED');return null;};
 const checked=new Map();let reconciling=false,reconcileCursor=0;
 const reconcilePending=async()=>{if(reconciling||!adapter||mode!=='test')return;reconciling=true;try{const rows=db.prepare("SELECT orders.rowid AS cursor,orders.body FROM orders JOIN attempts ON attempts.orderId=orders.id WHERE json_extract(orders.body,'$.status')='pending' AND attempts.sessionId IS NOT NULL AND orders.rowid>? ORDER BY orders.rowid LIMIT 10").all(reconcileCursor);if(!rows.length)reconcileCursor=0;let n=0;for(const row of rows){reconcileCursor=row.cursor;const o=JSON.parse(row.body);if(orderLocks.has(o.id)||(checked.get(o.id)||0)>Date.now())continue;if(n++>=10)break;checked.set(o.id,Date.now()+60000);lockOrder(o.id);try{const result=await inspectCancellation(o,false);db.exec('BEGIN IMMEDIATE');try{if(result)settlePayment(o,result.paid,`reconcile:${result.attempt.sessionId}`);else cancelLocal(o);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}catch{}finally{orderLocks.delete(o.id);}}}finally{reconciling=false;}};
 const releaseUnstarted=()=>{for(const row of db.prepare("SELECT orders.body FROM orders LEFT JOIN attempts ON attempts.orderId=orders.id WHERE orders.userId IS NOT NULL AND json_extract(orders.body,'$.status')='pending' AND attempts.id IS NULL ORDER BY orders.rowid LIMIT 20").all()){const o=JSON.parse(row.body);if(Date.now()-Date.parse(o.createdAt)<30*60000||orderLocks.has(o.id))continue;lockOrder(o.id);try{db.exec('BEGIN IMMEDIATE');try{if(!db.prepare('SELECT id FROM attempts WHERE orderId=?').get(o.id))cancelLocal(o);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}finally{orderLocks.delete(o.id);}}};
 const reconcileTimer=setInterval(()=>{try{releaseUnstarted();}catch{}void reconcilePending();},60000);reconcileTimer.unref();
 const limits=new Map();
 function limit(key,n){const now=Date.now();let v=limits.get(key);if(!v||v.until<now){v={count:0,until:now+60000};limits.set(key,v);}if(++v.count>n)fail(429,'RATE_LIMITED');if(limits.size>10000)for(const [k,x] of limits)if(x.until<now)limits.delete(k);}
 function cart(s){const fingerprint=hash(JSON.stringify(courses));if(s.catalogHash!==fingerprint){db.prepare('UPDATE sessions SET catalogHash=?,revision=revision+1 WHERE id=?').run(fingerprint,s.id);s.catalogHash=fingerprint;s.revision++;}const ids=JSON.parse(s.cart);const items=ids.map(id=>courses.find(c=>c.id===id)).filter(Boolean).map(course=>({course,quantity:1,subtotalCents:course.priceCents}));return {items,totalCents:items.reduce((a,c)=>a+c.subtotalCents,0),currency:'BRL',revision:s.revision};}
 const server=http.createServer(async(req,res)=>{
 const requestId=randomUUID();let status=200,lockedOrder;
 const send=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 res.setHeader('Cache-Control','no-store');
 for(const [k,v] of Object.entries({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}))res.setHeader(k,v);
 try {
 const path=new URL(req.url,'http://localhost').pathname, method=req.method, ip=req.socket.remoteAddress;
 if(path.startsWith('/api/'))limit(`all:${ip}`,120);
 if(path.startsWith('/api/webhooks/')){
 limit(`hook:${ip}`,120);if(path!=='/api/webhooks/stripe'||method!=='POST'||mode!=='test'||!adapter)fail(400,'WEBHOOK_INVALID');
 let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>262144)fail(413,'BODY_TOO_LARGE');chunks.push(c);}let event;try{event=adapter.verifyWebhook(Buffer.concat(chunks),req.headers);}catch{fail(400,'WEBHOOK_INVALID');}
 if(db.prepare('SELECT id FROM events WHERE id=?').get(event.id))return send({received:true});
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return send({received:true});
 let paymentSession;try{paymentSession=await adapter.fetchPayment(event);}catch{fail(503,'PAYMENT_UNAVAILABLE');}
 const row=db.prepare('SELECT * FROM attempts WHERE sessionId=?').get(paymentSession.id);if(!row)return send({received:true});
 const stored=db.prepare('SELECT body FROM orders WHERE id=?').get(row.orderId);if(!stored)return send({received:true});const o=JSON.parse(stored.body);
 if(!adapter.valid(paymentSession,o,row)||o.paymentMode!=='test'||o.provider!=='stripe')return send({received:true});
 db.exec('BEGIN IMMEDIATE');try{if(!db.prepare('SELECT id FROM events WHERE id=? OR paymentId=?').get(event.id,paymentSession.payment_intent)){db.prepare('INSERT INTO events VALUES(?,?)').run(event.id,paymentSession.payment_intent);settle(o);}db.exec('COMMIT');}catch{db.exec('ROLLBACK');fail(503,'PAYMENT_UNAVAILABLE');}return send({received:true});}

 if(method==='GET'&&(path==='/api/schedule'||path.startsWith('/api/certificates/verify/')))if(await academic.handleAcademic({method,path:req.url,body:{},user:null,send,res,fail}))return;
 if(method==='GET'&&path==='/api/health')return send({status:'ok'});
 if(method==='GET'&&path==='/api/courses')return send({courses:academic.augmentCourses()});
 if(method==='GET'&&path.startsWith('/api/courses/'))return send(academic.augmentCourses().find(c=>c.id===path.slice(13))||fail(404,'NOT_FOUND'));
 const rawCookie=req.headers.cookie?.match(/(?:^|;\s*)uniesp_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 let s=rawCookie?db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(hash(rawCookie),Date.now()):null;
 if(method==='GET'&&path==='/api/session'){
 if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')fail(403,'ORIGIN_INVALID');
 if(!s){limit(`session:${ip}`,20);const token=randomBytes(32).toString('hex');s={id:hash(token),csrf:randomBytes(32).toString('hex'),expires:Date.now()+86400000,cart:'[]',revision:0};db.prepare('INSERT INTO sessions(id,csrf,expires) VALUES(?,?,?)').run(s.id,s.csrf,s.expires);res.setHeader('Set-Cookie',`uniesp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${origin.startsWith('https:')?'; Secure':''}`);}
 return send({csrfToken:s.csrf,payment,authenticated:!!s.userId,pendingCartAvailable:JSON.parse(s.pendingCart||'[]').some(id=>courses.some(c=>c.id===id))});}
 if(method==='GET'&&path==='/api/auth/logout/complete'){
 const ticket=new URL(req.url,origin).searchParams.get('ticket')||'';const flow=db.prepare('SELECT * FROM logout_flows WHERE ticket=? AND expires>?').get(hash(ticket),Date.now());if(!flow)fail(400,'LOGOUT_INVALID');
 db.prepare('DELETE FROM logout_flows WHERE ticket=?').run(hash(ticket));const url=oidc?await oidc.logout(flow.idToken):origin;res.writeHead(303,{Location:url});return res.end();}
 if(method==='GET'&&path==='/api/auth/callback'){
 const u=new URL(req.url,origin),state=u.searchParams.get('state'),code=u.searchParams.get('code');
 const flow=db.prepare('SELECT * FROM auth_flows WHERE state=?').get(state||'');
 if(u.searchParams.getAll('state').length!==1||u.searchParams.getAll('code').length!==1||!oidc||!s||!flow||flow.sessionId!==s.id||flow.expires<Date.now()||!code)fail(400,'AUTH_CALLBACK_INVALID');
 db.prepare('DELETE FROM auth_flows WHERE state=?').run(state);
 let identity;try{identity=await oidc.finish({...flow,code});}catch{fail(400,'AUTH_CALLBACK_INVALID');}
 if(!db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(s.id,Date.now()))fail(400,'AUTH_CALLBACK_INVALID');
 const existing=db.prepare('SELECT id FROM users WHERE issuer=? AND sub=?').get(identity.issuer,identity.sub);const id=existing?.id||randomUUID();
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?) ON CONFLICT(issuer,sub) DO UPDATE SET displayName=excluded.displayName,email=excluded.email,emailVerified=excluded.emailVerified,roles=excluded.roles').run(id,identity.issuer,identity.sub,identity.displayName,identity.email,Number(identity.emailVerified),JSON.stringify(identity.roles));
 const token=randomBytes(32).toString('hex'),sid=hash(token);db.prepare('INSERT INTO sessions(id,csrf,expires,cart,userId,idToken,pendingCart) VALUES(?,?,?,?,?,?,?)').run(sid,randomBytes(32).toString('hex'),Math.min(Date.now()+86400000,identity.expires),'[]',id,identity.idToken,s.userId?'[]':s.cart);
 db.prepare("UPDATE sessions SET expires=0,cart='[]',userId=NULL,idToken=NULL WHERE id=?").run(s.id);
 res.setHeader('Set-Cookie',`uniesp_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0,Math.floor((identity.expires-Date.now())/1000))}${origin.startsWith('https:')?'; Secure':''}`);res.writeHead(303,{Location:'/area-aluno'});return res.end();}
 if(!path.startsWith('/api/')){
 if(method!=='GET')fail(404,'NOT_FOUND');const file=resolve(webDir,'.'+decodeURIComponent(path));if(file!==webDir&&!file.startsWith(webDir+'/'))fail(404,'NOT_FOUND');const target=existsSync(file)&&statSync(file).isFile()?file:resolve(webDir,'index.html');if(!existsSync(target))fail(404,'NOT_FOUND');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.svg':'image/svg+xml'})[extname(target)]||'application/octet-stream');return res.end(readFileSync(target));}
 if(!s)fail(401,'SESSION_REQUIRED');
 let body={};
 if(['POST','PUT','DELETE','PATCH'].includes(method)){
 if(req.headers.origin!==origin)fail(403,'ORIGIN_INVALID');if(!equal(req.headers['x-csrf-token'],s.csrf))fail(403,'CSRF_INVALID');
 const group=path==='/api/chat'?'chat':path.endsWith('/checkout')?'checkout':'write';limit(`${group}:${s.id}`,{chat:10,checkout:5,write:30}[group]);limit(`${group}:${ip}`,{chat:30,checkout:20,write:60}[group]);
 if(req.headers['content-type']?.split(';')[0]!=='application/json')fail(415,'CONTENT_TYPE');let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>16384)fail(413,'BODY_TOO_LARGE');chunks.push(c);}try{body=JSON.parse(Buffer.concat(chunks));}catch{fail(400,'JSON_INVALID');}if(!body||Array.isArray(body)||typeof body!=='object')fail(422,'VALIDATION');}
 s=db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(s.id,Date.now());if(!s)fail(401,'SESSION_REQUIRED');
 let user=null;if(s.userId){const u=db.prepare('SELECT * FROM users WHERE id=?').get(s.userId);if(u)user={id:u.id,displayName:u.displayName,email:u.email,emailVerified:!!u.emailVerified,roles:JSON.parse(u.roles)};}
 if(method==='GET'&&path==='/api/auth/me')return send({user});
 if(method==='POST'&&path==='/api/auth/login'){
 if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')fail(403,'ORIGIN_INVALID');if(!oidc)fail(503,'AUTH_UNAVAILABLE');if(Object.keys(body).some(k=>!['intent','returnTo'].includes(k))||body.returnTo!=='/area-aluno')fail(422,'VALIDATION');const intent=body.intent;if(!['login','register','reset'].includes(intent))fail(422,'VALIDATION');db.prepare('DELETE FROM auth_flows WHERE expires<?').run(Date.now());const f=oidc.start(intent);db.prepare('INSERT INTO auth_flows VALUES(?,?,?,?,?)').run(f.state,s.id,f.nonce,f.verifier,Date.now()+600000);return send({redirectUrl:f.url,...(intent==='reset'?{recoveryInstructions:'Na página de acesso, selecione Esqueceu sua senha? para receber o email de recuperação.'}:{})});}
 if(method==='POST'&&['/api/auth/cart/import','/api/auth/logout'].includes(path)&&Object.keys(body).length)fail(422,'VALIDATION');
 if(method==='POST'&&path==='/api/auth/cart/import'){if(!user)fail(401,'AUTH_REQUIRED');const ids=[...new Set([...JSON.parse(s.cart),...JSON.parse(s.pendingCart||'[]')])].filter(id=>courses.some(c=>c.id===id));db.prepare("UPDATE sessions SET cart=?,pendingCart='[]',revision=revision+1 WHERE id=?").run(JSON.stringify(ids),s.id);return send(cart(db.prepare('SELECT * FROM sessions WHERE id=?').get(s.id)));}
 if(method==='POST'&&path==='/api/auth/logout'){const ticket=randomBytes(32).toString('hex');db.prepare('DELETE FROM logout_flows WHERE expires<?').run(Date.now());db.prepare('INSERT INTO logout_flows VALUES(?,?,?)').run(hash(ticket),s.idToken,Date.now()+300000);const url=`/api/auth/logout/complete?ticket=${ticket}`;db.prepare("UPDATE sessions SET expires=0,cart='[]',userId=NULL,idToken=NULL WHERE id=?").run(s.id);res.setHeader('Set-Cookie','uniesp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return send({redirectUrl:url});}
 if((path==='/api/orders'&&method==='POST')||path.startsWith('/api/orders/')||path.startsWith('/api/demo/orders/')||path==='/api/student/orders'){if(!user)fail(401,'AUTH_REQUIRED');if(!user.emailVerified)fail(403,'EMAIL_UNVERIFIED');}
 if(method==='GET'&&path==='/api/student/orders')return send({orders:db.prepare('SELECT body FROM orders WHERE userId=?').all(user.id).map(r=>JSON.parse(r.body))});
 if(user&&!user.emailVerified&&/^\/api\/(admin|teacher|student)\//.test(path))fail(403,'EMAIL_UNVERIFIED');
 if(await academic.handleAcademic({method,path:req.url,body,user,send,res,fail}))return;
 const keys=(allowed)=>{if(Object.keys(body).some(k=>!allowed.includes(k)))fail(422,'VALIDATION');};
 const orderMatch=path.match(/^\/api\/orders\/([^/]+)(?:\/(checkout|reconcile|cancel))?$/)||path.match(/^\/api\/demo\/orders\/([^/]+)\/(complete)$/);
 let order;
 if(orderMatch){const row=db.prepare('SELECT body FROM orders WHERE id=? AND userId=?').get(orderMatch[1],user?.id||'');if(!row)fail(404,'NOT_FOUND');order=JSON.parse(row.body);}
 if(method==='POST'&&orderMatch?.[2]==='reconcile'){if(Object.keys(body).length)fail(422,'VALIDATION');if(!adapter||mode!=='test')fail(503,'PAYMENT_DISABLED');const attempt=db.prepare('SELECT * FROM attempts WHERE orderId=?').get(order.id);if(!attempt?.sessionId)fail(409,'CHECKOUT_REQUIRED');let verified;try{verified=await adapter.fetchPayment({data:{object:{id:attempt.sessionId}}});}catch{fail(503,'PAYMENT_UNAVAILABLE');}if(adapter.valid(verified,order,attempt)){db.exec('BEGIN IMMEDIATE');try{const fresh=JSON.parse(db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body);settlePayment(fresh,verified,`reconcile:${attempt.sessionId}`);db.exec('COMMIT');}catch{db.exec('ROLLBACK');fail(503,'PAYMENT_UNAVAILABLE');}}return send(JSON.parse(db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body));}
 if(method==='GET'&&path==='/api/cart')return send(cart(s));
 if(method==='GET'&&orderMatch&&!orderMatch[2])return send(order);
 if(method==='PUT'&&path==='/api/cart'){keys(['courseIds']);const a=body.courseIds;if(!Array.isArray(a)||a.length>20||new Set(a).size!==a.length||a.some(id=>typeof id!=='string'||!courses.some(c=>c.id===id)))fail(422,'VALIDATION');db.prepare('UPDATE sessions SET cart=?,revision=revision+1 WHERE id=?').run(JSON.stringify(a),s.id);return send(cart(db.prepare('SELECT * FROM sessions WHERE id=?').get(s.id)));}
 if(method==='POST'&&path==='/api/chat'){keys(['message','courseId']);if(typeof body.message!=='string'||!body.message.trim()||body.message.length>1000||body.courseId!==undefined&&!courses.some(c=>c.id===body.courseId))fail(422,'VALIDATION');const a=answer(body.message,body.courseId);return send({answer:a.answer,engine:'catalog-faq',sources:a.sourceUrls.map(url=>({label:'Snapshot institucional 28/10/2026',url,kind:'official'})),courseIds:a.courseIds,unsupported:a.unsupported});}
 if(method==='POST'&&(path==='/api/orders'||orderMatch?.[2])){
 keys(path==='/api/orders'?['cartRevision','selections']:[]);const key=req.headers['idempotency-key'];if(!uuid.test(key||''))fail(422,'IDEMPOTENCY_REQUIRED');const digest=hash(JSON.stringify(body));
 const cached=db.prepare('SELECT * FROM idem WHERE owner=? AND route=? AND key=?').get(s.id,path,key);
 if(cached){if(cached.digest!==digest)fail(409,'IDEMPOTENCY_CONFLICT');return send(JSON.parse(cached.body),cached.status);}
 if(['checkout','cancel'].includes(orderMatch?.[2])){lockOrder(order.id);lockedOrder=order.id;order=JSON.parse(db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body);}
 if(orderMatch?.[2]==='cancel'){
 let result=order;if(order.status==='pending'){let paid;try{paid=await inspectCancellation(order,true);}catch{fail(503,'PAYMENT_UNAVAILABLE');}db.exec('BEGIN IMMEDIATE');try{if(paid){settlePayment(order,paid.paid,`reconcile:${paid.attempt.sessionId}`);result=JSON.parse(db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body);}else result=cancelLocal(order);db.prepare('INSERT INTO idem VALUES(?,?,?,?,?,?)').run(s.id,path,key,digest,200,JSON.stringify(result));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}return send(result);}
 let externalCheckout;
 if(orderMatch?.[2]==='checkout'&&mode==='test'&&adapter){
 if(order.paymentMode!=='test'||order.provider!=='stripe')fail(409,'PAYMENT_MODE_MISMATCH');if(order.status!=='pending')fail(409,'ORDER_TERMINAL');
 let attempt=db.prepare('SELECT * FROM attempts WHERE orderId=?').get(order.id);
 if(!attempt){const id=randomUUID();db.prepare('INSERT INTO attempts(id,orderId) VALUES(?,?)').run(id,order.id);attempt={id,orderId:order.id};}
 if(attempt.body){externalCheckout=JSON.parse(attempt.body);
 if(Date.parse(externalCheckout.expiresAt)<=Date.now()){
 let verified;try{verified=await adapter.fetchPayment({data:{object:{id:attempt.sessionId}}});}catch{fail(503,'PAYMENT_UNAVAILABLE');}
 if(adapter.valid(verified,order,attempt)){db.exec('BEGIN IMMEDIATE');try{settlePayment(order,verified,`reconcile:${attempt.sessionId}`);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}fail(409,'ORDER_TERMINAL');}
 if(!verifyAttempt(verified,order,attempt)||verified.status!=='expired')fail(409,'CHECKOUT_NOT_EXPIRED');
 const next=randomUUID();const changed=db.prepare('UPDATE attempts SET id=?,sessionId=NULL,body=NULL WHERE orderId=? AND id=?').run(next,order.id,attempt.id);if(!changed.changes)fail(409,'CHECKOUT_CHANGED');attempt={id:next};externalCheckout=null;
 }}
 if(!externalCheckout){try{externalCheckout=await adapter.createCheckout(order,attempt.id);}catch{fail(503,'PAYMENT_UNAVAILABLE');}db.prepare('UPDATE attempts SET sessionId=?,body=? WHERE id=?').run(externalCheckout.providerSessionId,JSON.stringify(externalCheckout),attempt.id);}
 }
 db.exec('BEGIN IMMEDIATE');try{const previous=db.prepare('SELECT * FROM idem WHERE owner=? AND route=? AND key=?').get(s.id,path,key);if(previous){if(previous.digest!==digest)fail(409,'IDEMPOTENCY_CONFLICT');db.exec('COMMIT');return send(JSON.parse(previous.body),previous.status);}
 let result;
 if(orderMatch){order=JSON.parse(db.prepare('SELECT body FROM orders WHERE id=?').get(order.id).body);if(!db.prepare('SELECT id FROM sessions WHERE id=? AND expires>? AND userId=?').get(s.id,Date.now(),user.id))fail(401,'SESSION_REQUIRED');}
 if(path==='/api/orders'){s=db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(s.id,Date.now());if(!s)fail(401,'SESSION_REQUIRED');const freshCart=cart(s);if(!Number.isSafeInteger(body.cartRevision))fail(422,'VALIDATION');if(body.cartRevision!==s.revision)fail(409,'CART_CHANGED');const c=freshCart;if(!c.items.length)fail(422,'CART_EMPTY');if(c.items.some(i=>!i.course.available))fail(422,'COURSE_UNAVAILABLE');if(!Number.isSafeInteger(c.totalCents)||c.totalCents<=0||c.totalCents>100000000||c.items.some(i=>!Number.isSafeInteger(i.course.priceCents)||i.course.priceCents<=0))fail(422,'INVALID_CATALOG_PRICE');const now=new Date().toISOString();result={id:randomUUID(),userId:user.id,items:c.items.map(i=>({courseId:i.course.id,title:i.course.title,quantity:1,unitPriceCents:i.course.priceCents})),totalCents:c.totalCents,currency:'BRL',status:'pending',paymentMode:payment.mode,provider:payment.provider,createdAt:now,updatedAt:now};db.prepare('INSERT INTO orders(id,owner,body,userId) VALUES(?,?,?,?)').run(result.id,s.id,JSON.stringify(result),user.id);if(!Array.isArray(body.selections)||body.selections.length!==c.items.length||c.items.some(i=>body.selections.filter(x=>x.courseId===i.course.id).length!==1))fail(422,'SELECTIONS_INVALID');academic.reserveOrder({orderId:result.id,userId:user.id,selections:body.selections,now:new Date().toISOString()});notify(result,'purchase');status=201;}
 else if(orderMatch[2]==='checkout'){if(!payment.checkoutEnabled)fail(503,'PAYMENT_DISABLED');if(order.status!=='pending')fail(409,'ORDER_TERMINAL');result={orderId:order.id,mode:payment.mode,redirectUrl:externalCheckout?.url||null,expiresAt:externalCheckout?.expiresAt||null};}
 else {if(mode!=='demo'||order.paymentMode!=='demo'||!path.startsWith('/api/demo/'))fail(404,'NOT_FOUND');if(!['pending','simulated_paid'].includes(order.status))fail(409,'ORDER_TERMINAL');result={...order,status:'simulated_paid',updatedAt:order.status==='simulated_paid'?order.updatedAt:new Date().toISOString()};db.prepare('UPDATE orders SET body=? WHERE id=? AND owner=?').run(JSON.stringify(result),order.id,s.id);}
 db.prepare('INSERT INTO idem VALUES(?,?,?,?,?,?)').run(s.id,path,key,digest,status,JSON.stringify(result));db.exec('COMMIT');return send(result,status);
 }catch(e){db.exec('ROLLBACK');throw e;}}
 fail(404,'NOT_FOUND');
 }catch(e){if(e.status===429)res.setHeader('Retry-After','60');send({error:{code:e.code||'INTERNAL_ERROR',message:e.status?'Não foi possível concluir esta solicitação.':'Erro interno.',requestId}},e.status||500);}finally{if(lockedOrder)orderLocks.delete(lockedOrder);}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.timeout=10000;server.keepAliveTimeout=5000;
 return {server,db,close:()=>new Promise(r=>{clearInterval(mailTimer);clearInterval(reconcileTimer);server.close(()=>{db.close();r();});})};
}
