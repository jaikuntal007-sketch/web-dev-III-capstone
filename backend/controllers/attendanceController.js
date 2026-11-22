const Attendance = require('../models/Attendance');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { parsePagination, buildMeta } = require('../utils/pagination');
const { toDayStart } = require('../utils/date');
const { getAssignedCourse, getAccessibleCourse } = require('../services/courseAccess');
const attendanceService = require('../services/attendanceService');
const Course = require('../models/Course');
const { appEvents, EVENTS } = require('../events/appEvents');

const POPULATE = [
  { path: 'student', select: 'name rollNumber' },
  { path: 'course', select: 'courseCode courseName' },
  { path: 'faculty', select: 'name' },
];

// POST /attendance  { courseId, date, records: [{ studentId, status }] }
exports.mark = async (req, res) => {
  const { courseId, date, records } = req.body;
  const course = await getAssignedCourse(courseId, req.user);
  const day = toDayStart(date);
  if (day > new Date()) throw ApiError.badRequest('Attendance cannot be marked for a future date');
  if (!records.length) throw ApiError.badRequest('At least one attendance record is required');

  const enrolled = new Set(course.students.map(String));
  const seen = new Set();
  for (const r of records) {
    if (!r || !['Present', 'Absent'].includes(r.status)) throw ApiError.badRequest('Each record needs status Present or Absent');
    if (!enrolled.has(String(r.studentId))) throw ApiError.badRequest(`Student ${r.studentId} is not enrolled in this course`);
    if (seen.has(String(r.studentId))) throw ApiError.badRequest(`Student ${r.studentId} appears more than once`);
    seen.add(String(r.studentId));
  }

  const existing = await Attendance.find({ course: course._id, date: day, student: { $in: [...seen] } }).select('student');
  if (existing.length) {
    throw ApiError.conflict(
      `Duplicate attendance: ${existing.length} student(s) already have attendance recorded for ${date}. Edit the existing records instead.`
    );
  }

  const docs = await Attendance.insertMany(
    records.map((r) => ({ student: r.studentId, course: course._id, faculty: req.user._id, date: day, status: r.status }))
  );

  // Decoupled side effects (logging, real-time notifications) happen in the event listener.
  appEvents.emit(EVENTS.ATTENDANCE_MARKED, {
    courseId: course._id,
    courseCode: course.courseCode,
    facultyId: req.user._id,
    date,
    records: docs.map((d) => ({ student: d.student, status: d.status })),
  });

  sendSuccess(res, { count: docs.length, date, courseId: course._id }, 'Attendance marked successfully', 201);
};

// Builds the Mongo filter that restricts a user to the attendance they are allowed to see.
async function scopeFilter(user) {
  if (user.role === 'student') return { student: user._id };
  if (user.role === 'faculty') {
    const ids = (await Course.find({ faculty: user._id }).select('_id')).map((c) => c._id);
    return { course: { $in: ids } };
  }
  return {};
}

// GET /attendance?course=&student=&date=&from=&to=&status=&page=&limit=
exports.list = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = await scopeFilter(req.user);
  const { course, student, date, from, to, status } = req.query;
  if (course) {
    if (filter.course) {
      const allowed = filter.course.$in.map(String).includes(course);
      filter.course = allowed ? course : { $in: [] };
    } else filter.course = course;
  }
  if (student && req.user.role !== 'student') filter.student = student;
  if (status) filter.status = status;
  if (date) filter.date = toDayStart(date);
  else if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = toDayStart(from);
    if (to) filter.date.$lte = toDayStart(to);
  }
  const [items, total] = await Promise.all([
    Attendance.find(filter).sort({ date: -1 }).skip(skip).limit(limit).populate(POPULATE),
    Attendance.countDocuments(filter),
  ]);
  sendSuccess(res, items, 'Attendance records retrieved', 200, buildMeta(page, limit, total));
};

// GET /attendance/my  - subject-wise totals and percentages for the logged-in student
exports.mySummary = async (req, res) => {
  sendSuccess(res, await attendanceService.studentSummary(req.user._id), 'Attendance summary retrieved');
};

// GET /attendance/sheet?course=&date=  - enrolled students plus any status already recorded that day
exports.sheet = async (req, res) => {
  const course = await getAssignedCourse(req.query.course, req.user);
  await course.populate('students', 'name rollNumber');
  const day = toDayStart(req.query.date);
  const existing = await Attendance.find({ course: course._id, date: day });
  const byStudent = new Map(existing.map((a) => [a.student.toString(), a]));
  const rows = course.students
    .map((s) => ({
      studentId: s._id,
      name: s.name,
      rollNumber: s.rollNumber,
      status: byStudent.get(s._id.toString())?.status || null,
      attendanceId: byStudent.get(s._id.toString())?._id || null,
    }))
    .sort((a, b) => (a.rollNumber || '').localeCompare(b.rollNumber || ''));
  sendSuccess(res, { course: { _id: course._id, courseCode: course.courseCode, courseName: course.courseName }, date: req.query.date, rows });
};

async function loadRecord(id, user) {
  const record = await Attendance.findById(id);
  if (!record) throw ApiError.notFound('Attendance record not found');
  return record;
}

exports.get = async (req, res) => {
  const record = await loadRecord(req.params.id, req.user);
  if (req.user.role === 'student' && record.student.toString() !== req.user._id.toString()) {
    throw ApiError.forbidden('You can only view your own attendance');
  }
  if (req.user.role === 'faculty') await getAssignedCourse(record.course, req.user);
  await record.populate(POPULATE);
  sendSuccess(res, record);
};

exports.update = async (req, res) => {
  const record = await loadRecord(req.params.id, req.user);
  await getAssignedCourse(record.course, req.user);
  record.status = req.body.status;
  await record.save();
  await record.populate(POPULATE);
  sendSuccess(res, record, 'Attendance updated successfully');
};

exports.remove = async (req, res) => {
  const record = await loadRecord(req.params.id, req.user);
  await getAssignedCourse(record.course, req.user);
  await record.deleteOne();
  sendSuccess(res, null, 'Attendance record deleted successfully');
};
