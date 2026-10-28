import {curriculumFor} from '../server/curriculum.mjs';
import {courses} from '../server/catalog.mjs';
import {createHash,randomUUID} from 'node:crypto';
// Seed persisted verified identities in tests; production has no authentication bypass.
export function authenticate(app,cookie){const id=randomUUID();app.db.prepare('INSERT INTO users(id,issuer,sub,displayName,email,emailVerified,roles) VALUES(?,?,?,?,?,?,?)').run(id,'https://fixture.test',id,'Fixture','fixture@example.test',1,'["aluno"]');app.db.prepare('UPDATE sessions SET userId=? WHERE id=?').run(id,createHash('sha256').update(cookie.split('=')[1]).digest('hex'));return id;}
export function selections(app,courseIds){return courseIds.map(courseId=>{const id=randomUUID();const c={id,courseId,curriculum:curriculumFor(courses.find(c=>c.id===courseId)),title:'Turma fixture',version:1,status:'published',capacity:20,timezone:'America/Fortaleza',modality:'ead',teacherIds:[],meetings:[],completionRule:{minimumGrade:null,minimumAttendancePercent:null}};app.db.prepare('INSERT INTO academic_cohorts VALUES(?,?)').run(id,JSON.stringify(c));return {courseId,cohortId:id,cohortVersion:1};});}
