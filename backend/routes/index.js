const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const validate = require('../utils/validate');
const auth = require('../controllers/authController');
const { makeUserController } = require('../controllers/userController');
const courses = require('../controllers/courseController');
const attendance = require('../controllers/attendanceController');
const announcements = require('../controllers/announcementController');
const reports = require('../controllers/reportController');

const router = express.Router();

const id = { id: { type: 'objectId', required: true } };
const userBody = (creating) => ({
  name: { type: 'string', min: 2, max: 100, required: creating },
  email: { type: 'email', required: creating },
  password: { type: 'string', min: 6, required: creating },
  department: { type: 'string', required: creating },
  phone: { type: 'string' },
});

// ---------- Auth ----------
const authRouter = express.Router();
authRouter.post('/login', validate({ body: { email: { type: 'email', required: true }, password: { type: 'string', required: true } } }), auth.login);
authRouter.post('/refresh', validate({ body: { refreshToken: { type: 'string', required: true } } }), auth.refresh);
authRouter.post('/logout', protect, validate({ body: { refreshToken: { type: 'string', required: true } } }), auth.logout);
authRouter.get('/me', protect, auth.me);
authRouter.post('/register', protect, authorize('admin'),
  validate({ body: { ...userBody(true), role: { type: 'enum', values: ['admin', 'faculty', 'student'], required: true } } }), auth.register);
router.use('/auth', authRouter);

// ---------- Students & Faculty (admin only) ----------
function mountUsers(path, role) {
  const c = makeUserController(role);
  const r = express.Router();
  r.use(protect, authorize('admin'));
  r.get('/', c.list);
  r.post('/', validate({ body: { ...userBody(true), ...(role === 'student' && { rollNumber: { type: 'string', required: true } }) } }), c.create);
  r.get('/:id', validate({ params: id }), c.get);
  r.put('/:id', validate({ params: id, body: userBody(false) }), c.update);
  r.delete('/:id', validate({ params: id }), c.remove);
  router.use(path, r);
}
mountUsers('/students', 'student');
mountUsers('/faculty', 'faculty');

// ---------- Courses ----------
const courseRouter = express.Router();
courseRouter.use(protect);
courseRouter.get('/', courses.list);
courseRouter.post('/', authorize('admin'), validate({ body: {
  courseCode: { type: 'string', min: 2, max: 20, required: true },
  courseName: { type: 'string', min: 2, max: 150, required: true },
  faculty: { type: 'objectId' },
} }), courses.create);
courseRouter.get('/:id', validate({ params: id }), courses.get);
courseRouter.put('/:id', authorize('admin'), validate({ params: id }), courses.update);
courseRouter.delete('/:id', authorize('admin'), validate({ params: id }), courses.remove);
courseRouter.put('/:id/faculty', authorize('admin'), validate({ params: id, body: { facultyId: { type: 'objectId' } } }), courses.assignFaculty);
courseRouter.get('/:id/students', authorize('admin', 'faculty'), validate({ params: id }), courses.students);
courseRouter.post('/:id/enroll', authorize('admin'), validate({ params: id, body: { studentIds: { type: 'array', required: true } } }), courses.enroll);
courseRouter.delete('/:id/enroll/:studentId', authorize('admin'),
  validate({ params: { ...id, studentId: { type: 'objectId', required: true } } }), courses.unenroll);
router.use('/courses', courseRouter);

// ---------- Attendance ----------
const attRouter = express.Router();
attRouter.use(protect);
attRouter.post('/', authorize('faculty'), validate({ body: {
  courseId: { type: 'objectId', required: true },
  date: { type: 'date', required: true },
  records: { type: 'array', required: true },
} }), attendance.mark);
attRouter.get('/', attendance.list);
attRouter.get('/my', authorize('student'), attendance.mySummary);
attRouter.get('/sheet', authorize('faculty'), validate({ query: { course: { type: 'objectId', required: true }, date: { type: 'date', required: true } } }), attendance.sheet);
attRouter.get('/:id', validate({ params: id }), attendance.get);
attRouter.put('/:id', authorize('faculty'), validate({ params: id, body: { status: { type: 'enum', values: ['Present', 'Absent'], required: true } } }), attendance.update);
attRouter.delete('/:id', authorize('faculty'), validate({ params: id }), attendance.remove);
router.use('/attendance', attRouter);

// ---------- Announcements ----------
const annRouter = express.Router();
annRouter.use(protect);
annRouter.get('/', announcements.list);
annRouter.post('/', authorize('admin', 'faculty'), validate({ body: {
  title: { type: 'string', min: 3, max: 150, required: true },
  message: { type: 'string', min: 3, max: 2000, required: true },
  target: { type: 'enum', values: ['university', 'course'], required: true },
  course: { type: 'objectId' },
} }), announcements.create);
annRouter.get('/:id', validate({ params: id }), announcements.get);
annRouter.put('/:id', authorize('admin', 'faculty'), validate({ params: id }), announcements.update);
annRouter.delete('/:id', authorize('admin', 'faculty'), validate({ params: id }), announcements.remove);
router.use('/announcements', annRouter);

// ---------- Reports ----------
const repRouter = express.Router();
repRouter.use(protect);
repRouter.get('/dashboard', reports.dashboard);
repRouter.get('/attendance/students', authorize('admin', 'faculty'), reports.studentWise);
repRouter.get('/attendance/courses', authorize('admin', 'faculty'), reports.courseWise);
repRouter.get('/enrollment', authorize('admin'), reports.enrollment);
router.use('/reports', repRouter);

module.exports = router;
