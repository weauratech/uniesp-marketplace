/* Runtime integration; no DB writes/bypasses. Requires seeded demo identities and real test gateway.
 * Run: node tests/v2-e2e.cjs. Does not persist credentials, cookies, CSRF or Stripe URLs.
 * Each run can create a pending real test order; resume it in UI instead of duplicating purchases.
 */
const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const origin='http://127.0.0.1:5177';
const pass=name=>console.log('PASS '+name);
async function api(page,path,method='GET',body){return page.evaluate(async({path,method,body})=>{const session=await fetch('/api/session').then(r=>r.json());const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken,'Idempotency-Key':crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};},{path,method,body});}
(async()=>{const credentials=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/secrets/demo-accounts.json')));const browser=await chromium.launch({headless:true});try{
async function login(role){const context=await browser.newContext();const page=await context.newPage();await page.goto(origin+'/area-aluno');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.locator('#username').fill(credentials[role].email);await page.locator('#password').fill(credentials[role].password);await page.locator('#kc-login').click();await page.waitForURL(origin+'/area-aluno');await page.waitForFunction(async()=>!!(await fetch('/api/auth/me').then(r=>r.json())).user);assert((await api(page,'/auth/me')).data.user.roles.includes(role));pass('Keycloak UI login and server role '+role);return page;}
const p=await login('aluno'),teacher=await login('professor'),admin=await login('admin');
const catalog=(await api(p,'/courses')).data.courses;assert(catalog.length>=6);assert(catalog.every(c=>c.curriculum.modules.length));pass('catalog and curriculum');
assert.equal((await api(p,'/admin/cohorts')).status,403);assert.equal((await api(teacher,'/admin/cohorts')).status,403);pass('server RBAC');
const base=catalog.flatMap(c=>c.cohorts).find(c=>c.modality==='presencial');assert(base);
const fixture={courseId:base.courseId,title:'QA v2 conflito temporário',capacity:2,modality:'presencial',teacherIds:base.teacherIds,completionRule:base.completionRule,meetings:base.meetings.map(({startsAt,endsAt,roomId,teacherId})=>({startsAt,endsAt,roomId,teacherId}))};
const draft=await api(admin,'/admin/cohorts','POST',fixture);assert.equal(draft.status,201);
const edit={...fixture,courseId:undefined,version:draft.data.version,status:'published'};
const overlap=await api(admin,'/admin/cohorts/'+draft.data.id,'PUT',edit);assert.equal(overlap.status,409);assert.equal(overlap.data.error.code,'SCHEDULE_CONFLICT');pass('schedule overlap rejected');
const adjacent=await api(admin,'/admin/cohorts/'+draft.data.id,'PUT',{...edit,meetings:fixture.meetings.map(m=>({...m,startsAt:m.endsAt,endsAt:new Date(Date.parse(m.endsAt)+3600000).toISOString()}))});assert.equal(adjacent.status,200);pass('schedule adjacency accepted');
assert.equal((await api(admin,'/admin/cohorts/'+adjacent.data.id,'PUT',{...edit,version:adjacent.data.version,status:'closed',meetings:adjacent.data.meetings})).status,200);pass('synthetic QA cohort closed');
const enrolled=(await api(p,'/student/enrollments')).data.enrollments;
const course=catalog.find(c=>!enrolled.some(e=>e.courseId===c.id)&&c.cohorts.some(t=>t.status==='published'&&t.availableSeats>0));assert(course,'No unowned available course');
await p.getByRole('button',{name:'Voltar aos cursos'}).click();await p.getByLabel('Buscar cursos').fill(course.title);await p.getByText('Conheça o curso →',{exact:true}).click();await p.getByText('Grade curricular',{exact:true}).waitFor();pass('UI search details curriculum');await p.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).click();await p.getByRole('button',{name:'Ver carrinho',exact:true}).click();const cohort=course.cohorts.find(c=>c.status==='published'&&c.modality==='ead'&&c.availableSeats>0);assert(cohort);await p.locator('select').last().selectOption(cohort.id);await p.getByRole('button',{name:'Ir ao checkout de teste',exact:true}).click();
try{await p.waitForURL('https://checkout.stripe.com/**',{timeout:20000});}catch{await p.screenshot({path:'/tmp/uniesp-v2-checkout-blocked.png'});throw Error('Hosted checkout unavailable; inspect pending order and gateway; no payment/academic claims');}
assert.equal(new URL(p.url()).hostname,'checkout.stripe.com');assert(/test|teste/i.test(await p.locator('body').innerText()));pass('hosted Stripe test indicator');
// Explicitly interactive public test values only, per https://docs.stripe.com/testing.
// Stop on anti-automation/CAPTCHA; no circumvention. Manual completion may resume acceptance.
console.log('BLOCKED Hosted test ready: complete public test-card UI and then academic acceptance; never mark paid locally');process.exitCode=2;
}finally{await browser.close();}})().catch(()=>{console.error('FAIL runtime journey (sanitized); inspect /tmp/uniesp-v2-checkout-blocked.png and gateway status');process.exitCode=1;});
