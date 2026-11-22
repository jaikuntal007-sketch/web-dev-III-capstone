// Integration tests: run against a real MongoDB (separate "campus_test" database).
// Usage: npm test   (MongoDB must be running locally)
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const mongoose = require('mongoose');
const { io: ioClient } = require('socket.io-client');

const app = require('../app');
const initSockets = require('../sockets');
const registerListeners = require('../events/listeners');
const { appEvents, EVENTS } = require('../events/appEvents');
const User = require('../models/User');
const Course = require('../models/Course');
const Attendance = require('../models/Attendance');
const Announcement = require('../models/Announcement');
const RefreshToken = require('../models/RefreshToken');

let server, base;
const ctx = {};

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const login = async (email, password) => (await api('POST', '/api/auth/login', { body: { email, password } })).body.data;

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const s = ioClient(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('socket:ready', () => resolve(s));
    s.on('connect_error', (e) => { s.close(); reject(e); });
  });
}
const waitFor = (socket, event, ms = 1500) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([User, Course, Attendance, Announcement, RefreshToken].map((m) => m.deleteMany({})));
  await Promise.all([User, Course, Attendance, Announcement, RefreshToken].map((m) => m.syncIndexes()));

  ctx.admin = await User.create({ name: 'Admin', email: 'admin@t.edu', password: 'secret123', role: 'admin', department: 'Admin' });
  ctx.f1 = await User.create({ name: 'Fac One', email: 'f1@t.edu', password: 'secret123', role: 'faculty', department: 'CS' });
  ctx.f2 = await User.create({ name: 'Fac Two', email: 'f2@t.edu', password: 'secret123', role: 'faculty', department: 'Math' });
  ctx.s1 = await User.create({ name: 'Stu One', email: 's1@t.edu', password: 'secret123', role: 'student', rollNumber: 'R1', department: 'CS' });
  ctx.s2 = await User.create({ name: 'Stu Two', email: 's2@t.edu', password: 'secret123', role: 'student', rollNumber: 'R2', department: 'CS' });
  ctx.s3 = await User.create({ name: 'Stu Three', email: 's3@t.edu', password: 'secret123', role: 'student', rollNumber: 'R3', department: 'CS' });
  ctx.course = await Course.create({ courseCode: 'T101', courseName: 'Testing', faculty: ctx.f1._id, students: [ctx.s1._id, ctx.s2._id] });

  server = http.createServer(app);
  initSockets(server);
  registerListeners();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});

test('passwords are stored hashed and never returned', async () => {
  const raw = await User.findOne({ email: 's1@t.edu' }).select('+password');
  assert.notEqual(raw.password, 'secret123');
  assert.match(raw.password, /^\$2[aby]\$/);
  const res = await login('s1@t.edu', 'secret123');
  assert.equal(res.user.password, undefined);
  ctx.s1Tokens = res;
});

test('login rejects wrong password and invalid input', async () => {
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 's1@t.edu', password: 'nope' } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { body: { email: 'not-an-email', password: 'x' } })).status, 400);
});

test('protected routes require a valid token', async () => {
  assert.equal((await api('GET', '/api/courses')).status, 401);
  assert.equal((await api('GET', '/api/courses', { token: 'garbage' })).status, 401);
});

test('refresh rotates tokens and old refresh token is rejected; logout invalidates', async () => {
  const t = await login('s2@t.edu', 'secret123');
  const r1 = await api('POST', '/api/auth/refresh', { body: { refreshToken: t.refreshToken } });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.data.accessToken && r1.body.data.refreshToken);
  const reuse = await api('POST', '/api/auth/refresh', { body: { refreshToken: t.refreshToken } });
  assert.equal(reuse.status, 401);
  const out = await api('POST', '/api/auth/logout', { token: r1.body.data.accessToken, body: { refreshToken: r1.body.data.refreshToken } });
  assert.equal(out.status, 200);
  const after = await api('POST', '/api/auth/refresh', { body: { refreshToken: r1.body.data.refreshToken } });
  assert.equal(after.status, 401);
});

test('role based access: students and faculty cannot manage students', async () => {
  const s = await login('s1@t.edu', 'secret123');
  const f = await login('f1@t.edu', 'secret123');
  assert.equal((await api('GET', '/api/students', { token: s.accessToken })).status, 403);
  assert.equal((await api('GET', '/api/students', { token: f.accessToken })).status, 403);
  assert.equal((await api('POST', '/api/courses', { token: f.accessToken, body: { courseCode: 'X1', courseName: 'Nope' } })).status, 403);
});

test('admin student CRUD with validation, duplicates, pagination and 404', async () => {
  const a = (await login('admin@t.edu', 'secret123')).accessToken;
  ctx.adminToken = a;
  const bad = await api('POST', '/api/students', { token: a, body: { name: 'X' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.length > 0);
  const created = await api('POST', '/api/students', { token: a, body: { name: 'New Student', email: 'new@t.edu', password: 'secret123', rollNumber: 'R9', department: 'CS' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.password, undefined);
  assert.equal(created.body.data.role, 'student');
  const dup = await api('POST', '/api/students', { token: a, body: { name: 'Dup', email: 'new@t.edu', password: 'secret123', rollNumber: 'R10', department: 'CS' } });
  assert.equal(dup.status, 409);
  const id = created.body.data._id;
  const upd = await api('PUT', `/api/students/${id}`, { token: a, body: { department: 'Physics' } });
  assert.equal(upd.body.data.department, 'Physics');
  const list = await api('GET', '/api/students?limit=2&page=1&q=stu', { token: a });
  assert.equal(list.status, 200);
  assert.ok(list.body.meta.total >= 3 && list.body.data.length <= 2);
  assert.equal((await api('GET', `/api/students/${id}`, { token: a })).status, 200);
  assert.equal((await api('DELETE', `/api/students/${id}`, { token: a })).status, 200);
  assert.equal((await api('GET', `/api/students/${id}`, { token: a })).status, 404);
  assert.equal((await api('GET', '/api/students/not-an-id', { token: a })).status, 400);
});

test('admin faculty CRUD, course CRUD, assign faculty and enrol students', async () => {
  const a = ctx.adminToken;
  const fac = await api('POST', '/api/faculty', { token: a, body: { name: 'Fac Three', email: 'f3@t.edu', password: 'secret123', department: 'Physics' } });
  assert.equal(fac.status, 201);
  const course = await api('POST', '/api/courses', { token: a, body: { courseCode: 'p200', courseName: 'Physics II' } });
  assert.equal(course.status, 201);
  assert.equal(course.body.data.courseCode, 'P200');
  assert.equal((await api('POST', '/api/courses', { token: a, body: { courseCode: 'P200', courseName: 'Dup' } })).status, 409);
  const cid = course.body.data._id;
  const assigned = await api('PUT', `/api/courses/${cid}/faculty`, { token: a, body: { facultyId: fac.body.data._id } });
  assert.equal(assigned.body.data.faculty.name, 'Fac Three');
  const badAssign = await api('PUT', `/api/courses/${cid}/faculty`, { token: a, body: { facultyId: String(ctx.s1._id) } });
  assert.equal(badAssign.status, 400);
  const enrol = await api('POST', `/api/courses/${cid}/enroll`, { token: a, body: { studentIds: [String(ctx.s1._id), String(ctx.s3._id)] } });
  assert.equal(enrol.body.data.studentCount, 2);
  const un = await api('DELETE', `/api/courses/${cid}/enroll/${ctx.s3._id}`, { token: a });
  assert.equal(un.status, 200);
  assert.equal((await api('DELETE', `/api/courses/${cid}/enroll/${ctx.s3._id}`, { token: a })).status, 404);
  assert.equal((await api('PUT', `/api/courses/${cid}`, { token: a, body: { courseName: 'Physics Two' } })).body.data.courseName, 'Physics Two');
  assert.equal((await api('DELETE', `/api/courses/${cid}`, { token: a })).status, 200);
  assert.equal((await api('GET', `/api/courses/${cid}`, { token: a })).status, 404);
  assert.equal((await api('DELETE', `/api/faculty/${fac.body.data._id}`, { token: a })).status, 200);
});

test('attendance: faculty marks, duplicates blocked, authorization enforced', async () => {
  const f1 = (await login('f1@t.edu', 'secret123')).accessToken;
  const f2 = (await login('f2@t.edu', 'secret123')).accessToken;
  const cid = String(ctx.course._id);
  const body = (date, s2) => ({ courseId: cid, date, records: [{ studentId: String(ctx.s1._id), status: 'Present' }, { studentId: String(ctx.s2._id), status: s2 }] });

  const eventSeen = new Promise((resolve) => appEvents.once(EVENTS.ATTENDANCE_MARKED, resolve));
  const ok = await api('POST', '/api/attendance', { token: f1, body: body('2026-11-02', 'Present') });
  assert.equal(ok.status, 201);
  const evt = await eventSeen;
  assert.equal(evt.courseCode, 'T101');
  assert.equal(evt.records.length, 2);

  assert.equal((await api('POST', '/api/attendance', { token: f1, body: body('2026-11-03', 'Absent') })).status, 201);
  const dup = await api('POST', '/api/attendance', { token: f1, body: body('2026-11-02', 'Present') });
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /Duplicate/);
  assert.equal((await Attendance.countDocuments({ course: ctx.course._id })).valueOf(), 4);

  assert.equal((await api('POST', '/api/attendance', { token: f2, body: body('2026-11-04', 'Present') })).status, 403);
  assert.equal((await api('POST', '/api/attendance', { token: f1, body: { courseId: cid, date: '2026-11-04', records: [{ studentId: String(ctx.s3._id), status: 'Present' }] } })).status, 400);
  assert.equal((await api('POST', '/api/attendance', { token: f1, body: body('2999-01-01', 'Present') })).status, 400);
  assert.equal((await api('POST', '/api/attendance', { token: f1, body: { courseId: cid, date: 'bad', records: [] } })).status, 400);
  assert.equal((await api('POST', '/api/attendance', { token: ctx.adminToken, body: body('2026-11-05', 'Present') })).status, 403);

  const sheet = await api('GET', `/api/attendance/sheet?course=${cid}&date=2026-11-03`, { token: f1 });
  assert.equal(sheet.body.data.rows.find((r) => r.rollNumber === 'R2').status, 'Absent');
  const rec = (await api('GET', `/api/attendance?course=${cid}&student=${ctx.s2._id}&date=2026-11-03`, { token: f1 })).body.data[0];
  assert.equal((await api('PUT', `/api/attendance/${rec._id}`, { token: f1, body: { status: 'Present' } })).body.data.status, 'Present');
  assert.equal((await api('PUT', `/api/attendance/${rec._id}`, { token: f2, body: { status: 'Absent' } })).status, 403);
  assert.equal((await api('PUT', `/api/attendance/${rec._id}`, { token: f1, body: { status: 'Late' } })).status, 400);
  await api('PUT', `/api/attendance/${rec._id}`, { token: f1, body: { status: 'Absent' } });
});

test('students see only their own attendance with backend-calculated percentage', async () => {
  const s2 = (await login('s2@t.edu', 'secret123')).accessToken;
  const s1 = (await login('s1@t.edu', 'secret123')).accessToken;
  const mine = await api('GET', '/api/attendance/my', { token: s2 });
  assert.equal(mine.status, 200);
  const row = mine.body.data.courses[0];
  assert.equal(row.totalClasses, 2);
  assert.equal(row.classesAttended, 1);
  assert.equal(row.percentage, 50);
  assert.equal(mine.body.data.overall.percentage, 50);
  const s1sum = (await api('GET', '/api/attendance/my', { token: s1 })).body.data;
  assert.equal(s1sum.overall.percentage, 100);

  const list = await api('GET', `/api/attendance?student=${ctx.s1._id}`, { token: s2 });
  assert.ok(list.body.data.every((r) => r.student._id === String(ctx.s2._id)), 'student must only receive own records');
  const s1Rec = await Attendance.findOne({ student: ctx.s1._id });
  assert.equal((await api('GET', `/api/attendance/${s1Rec._id}`, { token: s2 })).status, 403);
  assert.equal((await api('GET', '/api/attendance/my', { token: ctx.adminToken })).status, 403);
});

test('aggregation reports: student-wise, course-wise, enrolment, role scoping', async () => {
  const a = ctx.adminToken;
  const f1 = (await login('f1@t.edu', 'secret123')).accessToken;
  const f2 = (await login('f2@t.edu', 'secret123')).accessToken;
  const sw = await api('GET', '/api/reports/attendance/students', { token: a });
  assert.equal(sw.status, 200);
  assert.equal(sw.body.data.length, 2);
  assert.equal(sw.body.data.find((r) => r.rollNumber === 'R2').percentage, 50);
  const low = await api('GET', '/api/reports/attendance/students?below=75', { token: a });
  assert.deepEqual(low.body.data.map((r) => r.rollNumber), ['R2']);
  const cw = (await api('GET', '/api/reports/attendance/courses', { token: a })).body.data[0];
  assert.equal(cw.courseCode, 'T101');
  assert.equal(cw.totalSessions, 2);
  assert.equal(cw.averagePercentage, 75);
  assert.equal((await api('GET', '/api/reports/attendance/courses', { token: f2 })).body.data.length, 0);
  assert.equal((await api('GET', '/api/reports/attendance/courses', { token: f1 })).body.data.length, 1);
  assert.equal((await api('GET', `/api/reports/attendance/students?course=${ctx.course._id}`, { token: f2 })).status, 403);
  const en = (await api('GET', '/api/reports/enrollment', { token: a })).body.data;
  assert.equal(en.summary.totalEnrolments, 2);
  assert.equal(en.courses[0].faculty, 'Fac One');
  assert.equal(en.byDepartment[0].department, 'CS');
  const s = (await login('s1@t.edu', 'secret123')).accessToken;
  assert.equal((await api('GET', '/api/reports/enrollment', { token: s })).status, 403);
  assert.equal((await api('GET', '/api/reports/attendance/courses', { token: s })).status, 403);
  const dash = (await api('GET', '/api/reports/dashboard', { token: a })).body.data;
  assert.equal(dash.students, 3);
  assert.equal(dash.courses, 1);
});

test('announcements: role rules, visibility and CRUD', async () => {
  const a = ctx.adminToken;
  const f1 = (await login('f1@t.edu', 'secret123')).accessToken;
  const f2 = (await login('f2@t.edu', 'secret123')).accessToken;
  const s1 = (await login('s1@t.edu', 'secret123')).accessToken;
  const s3 = (await login('s3@t.edu', 'secret123')).accessToken;
  const cid = String(ctx.course._id);

  assert.equal((await api('POST', '/api/announcements', { token: s1, body: { title: 'Hello all', message: 'Hello everyone', target: 'university' } })).status, 403);
  assert.equal((await api('POST', '/api/announcements', { token: f1, body: { title: 'Hello all', message: 'Hello everyone', target: 'university' } })).status, 403);
  assert.equal((await api('POST', '/api/announcements', { token: f2, body: { title: 'Hello all', message: 'Hello everyone', target: 'course', course: cid } })).status, 403);
  assert.equal((await api('POST', '/api/announcements', { token: f1, body: { title: 'Hi' } })).status, 400);
  assert.equal((await api('POST', '/api/announcements', { token: a, body: { title: 'No course', message: 'Missing course id', target: 'course' } })).status, 400);
  assert.equal((await api('POST', '/api/announcements', { token: f1, body: { title: 'No course', message: 'Missing course id', target: 'course' } })).status, 400);

  assert.equal((await api('POST', '/api/announcements', { token: a, body: { title: 'Campus closed', message: 'Holiday on Friday', target: 'university' } })).status, 201);
  const ca = await api('POST', '/api/announcements', { token: f1, body: { title: 'Test on Monday', message: 'Chapters 1-3', target: 'course', course: cid } });
  assert.equal(ca.status, 201);

  const feed1 = (await api('GET', '/api/announcements', { token: s1 })).body.data.map((x) => x.title);
  assert.deepEqual(feed1.sort(), ['Campus closed', 'Test on Monday']);
  const feed3 = (await api('GET', '/api/announcements', { token: s3 })).body.data.map((x) => x.title);
  assert.deepEqual(feed3, ['Campus closed']);
  assert.equal((await api('GET', `/api/announcements/${ca.body.data._id}`, { token: s3 })).status, 403);

  const id = ca.body.data._id;
  assert.equal((await api('PUT', `/api/announcements/${id}`, { token: f2, body: { title: 'Hack' } })).status, 403);
  assert.equal((await api('PUT', `/api/announcements/${id}`, { token: f1, body: { title: 'Test moved' } })).body.data.title, 'Test moved');
  assert.equal((await api('DELETE', `/api/announcements/${id}`, { token: f1 })).status, 200);
  assert.equal((await api('GET', `/api/announcements/${id}`, { token: a })).status, 404);
});

test('socket.io: JWT required, notifications reach only relevant users', async () => {
  await assert.rejects(connectSocket('bad-token'), /Invalid or expired token/);
  await assert.rejects(connectSocket(undefined), /Authentication required/);

  const f1 = (await login('f1@t.edu', 'secret123')).accessToken;
  const sock1 = await connectSocket((await login('s1@t.edu', 'secret123')).accessToken); // enrolled
  const sock3 = await connectSocket((await login('s3@t.edu', 'secret123')).accessToken); // NOT enrolled
  const cid = String(ctx.course._id);

  const p1 = waitFor(sock1, 'announcement:new');
  const p3 = waitFor(sock3, 'announcement:new');
  await api('POST', '/api/announcements', { token: f1, body: { title: 'Lab moved', message: 'Room 5', target: 'course', course: cid } });
  const got1 = await p1;
  assert.equal(got1.title, 'Lab moved');
  assert.equal(await p3, null, 'unrelated student must not be notified');

  const u1 = waitFor(sock1, 'announcement:new');
  const u3 = waitFor(sock3, 'announcement:new');
  await api('POST', '/api/announcements', { token: ctx.adminToken, body: { title: 'Exams', message: 'Next week', target: 'university' } });
  assert.equal((await u1).title, 'Exams');
  assert.equal((await u3).title, 'Exams');

  const a1 = waitFor(sock1, 'attendance:marked');
  const a3 = waitFor(sock3, 'attendance:marked');
  await api('POST', '/api/attendance', { token: f1, body: { courseId: cid, date: '2026-11-10', records: [{ studentId: String(ctx.s1._id), status: 'Absent' }, { studentId: String(ctx.s2._id), status: 'Present' }] } });
  const att = await a1;
  assert.equal(att.status, 'Absent');
  assert.equal(att.courseCode, 'T101');
  assert.equal(await a3, null);
  sock1.close(); sock3.close();
});

test('error handling: unknown route and malformed JSON use the standard JSON shape', async () => {
  const nf = await api('GET', '/api/does-not-exist');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.success, false);
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).success, false);
});

test('indexes exist: unique attendance index and TTL index', async () => {
  const att = await Attendance.collection.indexes();
  const unique = att.find((i) => i.unique && i.key.student === 1 && i.key.course === 1 && i.key.date === 1);
  assert.ok(unique, 'unique student+course+date index');
  assert.ok(att.find((i) => i.key.course === 1 && i.key.date === -1));
  const rt = await RefreshToken.collection.indexes();
  assert.ok(rt.find((i) => i.expireAfterSeconds === 0));
});
