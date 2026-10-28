import { randomUUID, randomBytes, createHash, createHmac } from 'node:crypto';
import { curriculumFor } from './curriculum.mjs';
const label='Demonstração acadêmica — sem validade oficial';
const error=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const valid=(ok)=>{if(!ok)error(422,'VALIDATION');};
const keys=(obj,allowed)=>valid(obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).every(k=>allowed.includes(k)));
const hash=t=>createHash('sha256').update(t).digest('hex');
const overlaps=(a,b)=>a.startsAt<b.endsAt&&b.startsAt<a.endsAt;
export function createAcademic({db,courses}) {
 db.exec(`CREATE TABLE IF NOT EXISTS academic_token_keys(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS academic_rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS academic_cohorts(id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS academic_reservations(orderId TEXT NOT NULL REFERENCES orders(id),courseId TEXT NOT NULL,cohortId TEXT NOT NULL REFERENCES academic_cohorts(id),userId TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,PRIMARY KEY(orderId,courseId));
 CREATE TABLE IF NOT EXISTS academic_enrollments(id TEXT PRIMARY KEY,orderId TEXT NOT NULL REFERENCES orders(id),courseId TEXT NOT NULL,userId TEXT NOT NULL REFERENCES users(id),cohortId TEXT NOT NULL REFERENCES academic_cohorts(id),body TEXT NOT NULL,UNIQUE(orderId,courseId));
 CREATE TABLE IF NOT EXISTS academic_certificates(id TEXT PRIMARY KEY,enrollmentId TEXT UNIQUE NOT NULL REFERENCES academic_enrollments(id),tokenHash TEXT UNIQUE NOT NULL,body TEXT NOT NULL);
 INSERT OR IGNORE INTO academic_rooms VALUES('lab-01','Laboratório demonstrativo 01'); INSERT OR IGNORE INTO academic_rooms VALUES('auditorio-01','Auditório demonstrativo 01');`);
 db.prepare('INSERT OR IGNORE INTO academic_token_keys VALUES(1,?)').run(randomBytes(32).toString('hex'));
 const tokenKey=db.prepare('SELECT secret FROM academic_token_keys WHERE id=1').get().secret;
 const certificateToken=id=>createHmac('sha256',Buffer.from(tokenKey,'hex')).update(id).digest('hex');
 const all=()=>db.prepare('SELECT body FROM academic_cohorts').all().map(r=>JSON.parse(r.body));
 const cohort=id=>{const r=db.prepare('SELECT body FROM academic_cohorts WHERE id=?').get(id);if(!r)error(404,'NOT_FOUND');return JSON.parse(r.body);};
 const order=id=>{const r=db.prepare('SELECT body,userId FROM orders WHERE id=?').get(id);if(!r)error(404,'NOT_FOUND');return {...JSON.parse(r.body),userId:r.userId};};
 const enroll=id=>{const r=db.prepare('SELECT * FROM academic_enrollments WHERE id=?').get(id);if(!r)error(404,'NOT_FOUND');return {...JSON.parse(r.body),userId:r.userId};};
 const reservations=()=>db.prepare('SELECT * FROM academic_reservations').all().map(r=>({...JSON.parse(r.body),userId:r.userId,orderId:r.orderId}));
 const enrollments=()=>db.prepare('SELECT id FROM academic_enrollments').all().map(r=>enroll(r.id));
 const seats=id=>reservations().filter(r=>r.cohortId===id).length+enrollments().filter(e=>e.cohortId===id&&e.status!=='cancelled').length;
 const view=c=>({...c,availableSeats:Math.max(0,c.capacity-seats(c.id))});
 const save=c=>db.prepare('INSERT INTO academic_cohorts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(c.id,JSON.stringify(c));
 const saveEnrollment=e=>db.prepare('UPDATE academic_enrollments SET body=? WHERE id=?').run(JSON.stringify(e),e.id);
 const eligible=e=>{const o=order(e.orderId),r=e.completionRule;return o.status==='paid'&&o.paymentMode==='test'&&e.status==='completed'&&e.progress.completedModuleIds.length===e.progress.totalModules&&(r.minimumGrade===null||e.grade!==null&&e.grade>=r.minimumGrade)&&(r.minimumAttendancePercent===null||e.attendancePercent!==null&&e.attendancePercent>=r.minimumAttendancePercent);};
 const publicEnrollment=e=>{const {userId,...rest}=e;return {...rest,certificateEligible:eligible(e)};};
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 function validateCohort(b,old) {
  keys(b,old?['version','title','capacity','status','modality','teacherIds','completionRule','meetings']:['courseId','title','capacity','modality','teacherIds','completionRule','meetings']);
  valid(typeof b.title==='string'&&b.title.trim().length>0&&b.title.length<=200&&Number.isInteger(b.capacity)&&b.capacity>=1&&b.capacity<=500);
  valid(['ead','presencial'].includes(b.modality)&&Array.isArray(b.teacherIds)&&b.teacherIds.length>0&&new Set(b.teacherIds).size===b.teacherIds.length);
  for(const id of b.teacherIds){const u=db.prepare('SELECT roles FROM users WHERE id=?').get(id);valid(u&&JSON.parse(u.roles).includes('professor'));}
  keys(b.completionRule,['minimumGrade','minimumAttendancePercent']);for(const [k,max] of [['minimumGrade',10],['minimumAttendancePercent',100]])valid(b.completionRule[k]===null||typeof b.completionRule[k]==='number'&&Number.isFinite(b.completionRule[k])&&b.completionRule[k]>=0&&b.completionRule[k]<=max);
  valid(Array.isArray(b.meetings)&&(b.modality==='ead'||b.meetings.length>0));
  const meetings=b.meetings.map(m=>{keys(m,['id','startsAt','endsAt','roomId','teacherId']);for(const k of ['startsAt','endsAt'])valid(typeof m[k]==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(m[k])&&Number.isFinite(Date.parse(m[k]))&&new Date(m[k]).toISOString().replace('.000Z','Z')===m[k].replace('.000Z','Z'));valid(m.startsAt<m.endsAt&&b.teacherIds.includes(m.teacherId)&&db.prepare('SELECT id FROM academic_rooms WHERE id=?').get(m.roomId));return {...m,startsAt:new Date(m.startsAt).toISOString(),endsAt:new Date(m.endsAt).toISOString(),id:m.id||old?.meetings[ b.meetings.indexOf(m)]?.id||randomUUID()};});
  valid(new Set(meetings.map(m=>m.id)).size===meetings.length);
  const c={...b,id:old?.id||randomUUID(),courseId:old?.courseId||b.courseId,version:(old?.version||0)+1,status:old?b.status:'draft',timezone:'America/Fortaleza',meetings};
  c.curriculum=old?.curriculum||curriculumFor(courses.find(x=>x.id===c.courseId)||{topics:[]});
  valid(courses.some(x=>x.id===c.courseId)&&['draft','published','closed'].includes(c.status));
  const conflict=(a,b)=>overlaps(a,b)&&(a.roomId===b.roomId||a.teacherId===b.teacherId);
  if(meetings.some((m,i)=>meetings.slice(i+1).some(n=>conflict(m,n))))error(409,'SCHEDULE_CONFLICT');
  if(c.status==='published'&&all().some(x=>x.id!==c.id&&x.status==='published'&&x.meetings.some(m=>meetings.some(n=>conflict(m,n)))))error(409,'SCHEDULE_CONFLICT');
  if(old&&seats(old.id)){if(b.capacity<old.capacity)error(409,'COHORT_IMMUTABLE');for(const k of ['meetings','teacherIds','modality','completionRule'])if(JSON.stringify(c[k])!==JSON.stringify(old[k]))error(409,'COHORT_IMMUTABLE');}
  return c;
 }
 function reserveOrder({orderId,userId,selections}) {
  const o=order(orderId);if(o.userId!==userId)error(404,'NOT_FOUND');valid(o.status==='pending'&&Array.isArray(selections)&&selections.length===o.items.length&&new Set(selections.map(s=>s.courseId)).size===selections.length);
  const result=[];
  for(const s of selections){keys(s,['courseId','cohortId','cohortVersion']);valid(o.items.some(i=>i.courseId===s.courseId));const c=cohort(s.cohortId);valid(c.courseId===s.courseId);if(c.version!==s.cohortVersion)error(409,'VERSION_CONFLICT');if(c.status!=='published')error(409,'COHORT_UNAVAILABLE');const existing=db.prepare('SELECT body FROM academic_reservations WHERE orderId=? AND courseId=?').get(orderId,s.courseId);if(existing){const r=JSON.parse(existing.body);if(r.cohortId!==s.cohortId)error(409,'RESERVATION_CONFLICT');result.push(r);continue;}
   const occupied=[...enrollments().filter(e=>e.status!=='cancelled'),...reservations()].filter(e=>e.userId===userId);
   if(occupied.some(e=>e.courseId===s.courseId))error(409,'ALREADY_ENROLLED');if(seats(c.id)>=c.capacity)error(409,'CAPACITY_EXCEEDED');if(occupied.some(e=>e.meetings.some(m=>c.meetings.some(n=>overlaps(m,n)))))error(409,'SCHEDULE_CONFLICT');
   const r={...s,meetings:c.meetings,completionRule:c.completionRule,teacherIds:c.teacherIds,cohortTitle:c.title,modality:c.modality,curriculum:c.curriculum};db.prepare('INSERT INTO academic_reservations VALUES(?,?,?,?,?)').run(orderId,s.courseId,c.id,userId,JSON.stringify(r));result.push(r);
  }return {reservations:result};
 }
 function fulfillPaidOrder({orderId,userId,now=new Date().toISOString()}) {
  const o=order(orderId);if(o.userId!==userId)error(404,'NOT_FOUND');if(o.status!=='paid'||o.paymentMode!=='test')error(409,'PAYMENT_REQUIRED');const existing=enrollments().filter(e=>e.orderId===orderId);if(existing.length===o.items.length)return {enrollments:existing.map(publicEnrollment)};
  const rs=reservations().filter(r=>r.orderId===orderId);if(rs.length!==o.items.length)error(409,'RESERVATION_REQUIRED');
  for(const r of rs){const e={...r,id:randomUUID(),orderId,userId,status:'active',paymentLabel:'teste',grade:null,attendancePercent:null,teacherComment:null,createdAt:now,progress:{completedModuleIds:[],totalModules:r.curriculum.modules.length}};db.prepare('INSERT INTO academic_enrollments VALUES(?,?,?,?,?,?)').run(e.id,orderId,r.courseId,userId,r.cohortId,JSON.stringify(e));}db.prepare('DELETE FROM academic_reservations WHERE orderId=?').run(orderId);return {enrollments:enrollments().filter(e=>e.orderId===orderId).map(publicEnrollment)};
 }
 const releaseOrder=({orderId})=>({released:Number(db.prepare('DELETE FROM academic_reservations WHERE orderId=?').run(orderId).changes)});
 const augmentCourses=()=>courses.map(c=>({...c,curriculum:curriculumFor(c),cohorts:all().filter(t=>t.courseId===c.id&&['published','closed'].includes(t.status)).map(view)}));
 const certView=c=>{const {token,...rest}=c;return {...rest,downloadUrl:`/api/student/certificates/${c.id}/pdf`,verificationUrl:`/api/certificates/verify/${certificateToken(c.id)}`};};
 async function handleAcademic({method,path,body={},user,send,res}) {
  const url=new URL(path,'http://local'),p=url.pathname;
  if(!/^\/api\/(schedule|admin\/(cohorts|resources)|teacher\/|student\/(enrollments|certificates)|certificates\/verify\/)/.test(p))return false;
  const respond=(v,status=200)=>{send(v,status);return true;};
  if(method==='GET'&&p==='/api/schedule')return respond({cohorts:all().filter(c=>c.status==='published'&&(!url.searchParams.has('courseId')||c.courseId===url.searchParams.get('courseId'))).map(view)});
  if(method==='GET'&&p.startsWith('/api/certificates/verify/')){const r=db.prepare('SELECT body FROM academic_certificates WHERE tokenHash=?').get(hash(p.split('/').pop()));return respond({valid:!!r&&eligible(enroll(JSON.parse(r.body).enrollmentId)),label});}
  if(!user)error(401,'AUTH_REQUIRED');const admin=user.roles.includes('admin');
  if(p.startsWith('/api/admin/')){if(!admin)error(403,'FORBIDDEN');
   if(method==='GET'&&p==='/api/admin/resources')return respond({rooms:db.prepare('SELECT * FROM academic_rooms').all(),teachers:db.prepare('SELECT id,displayName,roles FROM users').all().filter(u=>JSON.parse(u.roles).includes('professor')).map(({id,displayName})=>({id,displayName}))});
   if(method==='GET'&&p==='/api/admin/cohorts')return respond({cohorts:all().map(view)});
   if(method==='POST'&&p==='/api/admin/cohorts')return respond(tx(()=>{const c=validateCohort(body);save(c);return view(c);}),201);
   const id=p.match(/^\/api\/admin\/cohorts\/([^/]+)$/)?.[1];if(id&&['PUT','DELETE'].includes(method))return respond(tx(()=>{const old=cohort(id);if(body.version!==old.version)error(409,'VERSION_CONFLICT');if(method==='DELETE'){keys(body,['version']);if(old.status!=='draft'||seats(id))error(409,'COHORT_IMMUTABLE');db.prepare('DELETE FROM academic_cohorts WHERE id=?').run(id);return {deleted:true};}const c=validateCohort(body,old);save(c);return view(c);}));
  }
  const assigned=c=>admin||user.roles.includes('professor')&&c.teacherIds.includes(user.id);
  if(p.startsWith('/api/teacher/')){if(!admin&&!user.roles.includes('professor'))error(403,'FORBIDDEN');
   if(method==='GET'&&p==='/api/teacher/cohorts')return respond({cohorts:all().filter(assigned).map(view)});
   const id=p.match(/^\/api\/teacher\/cohorts\/([^/]+)\/records$/)?.[1];if(method==='GET'&&id){if(!assigned(cohort(id)))error(404,'NOT_FOUND');return respond({records:enrollments().filter(e=>e.cohortId===id).map(e=>({student:db.prepare('SELECT id,displayName FROM users WHERE id=?').get(e.userId),enrollment:publicEnrollment(e)}))});}
   const eid=p.match(/^\/api\/teacher\/enrollments\/([^/]+)\/record$/)?.[1];if(method==='PUT'&&eid)return respond(tx(()=>{const e=enroll(eid);if(!assigned(cohort(e.cohortId)))error(404,'NOT_FOUND');keys(body,['grade','attendancePercent','teacherComment','completed','completedModuleIds']);for(const [k,max] of [['grade',10],['attendancePercent',100]])valid(body[k]===null||typeof body[k]==='number'&&Number.isFinite(body[k])&&body[k]>=0&&body[k]<=max);valid(body.teacherComment===null||typeof body.teacherComment==='string'&&body.teacherComment.length<=2000);valid(typeof body.completed==='boolean');if(body.completedModuleIds!==undefined){valid(Array.isArray(body.completedModuleIds)&&new Set(body.completedModuleIds).size===body.completedModuleIds.length&&body.completedModuleIds.every(id=>e.curriculum.modules.some(m=>m.id===id)));e.progress.completedModuleIds=body.completedModuleIds;}Object.assign(e,{grade:body.grade,attendancePercent:body.attendancePercent,teacherComment:body.teacherComment,status:body.completed?'completed':'active'});saveEnrollment(e);return publicEnrollment(e);}));
  }
  if(p.startsWith('/api/student/')){if(!admin&&!user.roles.includes('aluno'))error(403,'FORBIDDEN');
   if(method==='GET'&&p==='/api/student/enrollments')return respond({enrollments:enrollments().filter(e=>e.userId===user.id).map(publicEnrollment)});
   if(method==='GET'&&p==='/api/student/certificates')return respond({certificates:db.prepare('SELECT body FROM academic_certificates').all().map(r=>JSON.parse(r.body)).filter(c=>{const e=enroll(c.enrollmentId);return e.userId===user.id&&eligible(e);}).map(certView)});
   const eid=p.match(/^\/api\/student\/enrollments\/([^/]+)\/certificate$/)?.[1];if(method==='POST'&&eid)return respond(tx(()=>{keys(body,[]);const e=enroll(eid);if(e.userId!==user.id)error(404,'NOT_FOUND');if(!eligible(e))error(409,'CERTIFICATE_INELIGIBLE');const old=db.prepare('SELECT body FROM academic_certificates WHERE enrollmentId=?').get(eid);if(old)return certView(JSON.parse(old.body));const c={id:randomUUID(),enrollmentId:eid,issuedAt:new Date().toISOString(),label};db.prepare('INSERT INTO academic_certificates VALUES(?,?,?,?)').run(c.id,eid,hash(certificateToken(c.id)),JSON.stringify(c));return certView(c);}),201);
   const cid=p.match(/^\/api\/student\/certificates\/([^/]+)\/pdf$/)?.[1];if(method==='GET'&&cid){const r=db.prepare('SELECT body FROM academic_certificates WHERE id=?').get(cid);if(!r)error(404,'NOT_FOUND');const c=JSON.parse(r.body),e=enroll(c.enrollmentId);if(e.userId!==user.id&&!admin)error(404,'NOT_FOUND');if(!eligible(e))error(409,'CERTIFICATE_INELIGIBLE');const pdf=demoPdf();if(!res)error(500,'PDF_RESPONSE_REQUIRED');res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store','Content-Disposition':'attachment; filename="demonstracao.pdf"','Content-Length':pdf.length});res.end(pdf);return true;}
  }
  error(404,'NOT_FOUND');
 }
 return {handleAcademic,reserveOrder,fulfillPaidOrder,releaseOrder,augmentCourses};
}
// Minimal standards-compliant textual PDF; no third-party dependencies or institutional artwork.
function demoPdf(){const stream='BT /F1 18 Tf 50 760 Td (Demonstracao academica) Tj 0 -30 Td /F1 12 Tf (Pagamento de teste - sem validade oficial ou institucional.) Tj ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let out='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(out);out+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(out);}
