const Course = require('../models/Course');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Announcement = require('../models/Announcement');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { parsePagination, buildMeta, escapeRegex } = require('../utils/pagination');
const { getAccessibleCourse } = require('../services/courseAccess');

const withCount = (course) => ({ ...course.toJSON(), studentCount: course.students.length });

// Admin sees all courses, faculty only their own, students only the ones they are enrolled in.
exports.list = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.user.role === 'faculty') filter.faculty = req.user._id;
  if (req.user.role === 'student') filter.students = req.user._id;
  if (req.query.faculty && req.user.role === 'admin') filter.faculty = req.query.faculty;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ courseCode: rx }, { courseName: rx }];
  }
  const [items, total] = await Promise.all([
    Course.find(filter).sort({ courseCode: 1 }).skip(skip).limit(limit)
      .populate('faculty', 'name email department').select(req.user.role === 'student' ? '-students' : ''),
    Course.countDocuments(filter),
  ]);
  const data = req.user.role === 'student' ? items.map((c) => c.toJSON()) : items.map(withCount);
  sendSuccess(res, data, 'Courses retrieved', 200, buildMeta(page, limit, total));
};

exports.get = async (req, res) => {
  const course = await getAccessibleCourse(req.params.id, req.user);
  await course.populate('faculty', 'name email department');
  if (req.user.role === 'student') {
    const { students, ...rest } = course.toJSON();
    return sendSuccess(res, rest);
  }
  await course.populate('students', 'name email rollNumber department');
  sendSuccess(res, withCount(course));
};

exports.create = async (req, res) => {
  const { courseCode, courseName, description, faculty } = req.body;
  if (faculty) await assertFaculty(faculty);
  const course = await Course.create({ courseCode, courseName, description, faculty: faculty || null });
  sendSuccess(res, course, 'Course created successfully', 201);
};

exports.update = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throw ApiError.notFound('Course not found');
  const { courseCode, courseName, description } = req.body;
  course.set({ ...(courseCode && { courseCode }), ...(courseName && { courseName }), ...(description !== undefined && { description }) });
  await course.save();
  sendSuccess(res, course, 'Course updated successfully');
};

exports.remove = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throw ApiError.notFound('Course not found');
  await Attendance.deleteMany({ course: course._id });
  await Announcement.deleteMany({ course: course._id });
  await course.deleteOne();
  sendSuccess(res, null, 'Course deleted successfully');
};

async function assertFaculty(id) {
  const user = await User.findOne({ _id: id, role: 'faculty' });
  if (!user) throw ApiError.badRequest('facultyId must belong to an existing faculty member');
  return user;
}

// PUT /courses/:id/faculty  { facultyId }  (facultyId: null removes the assignment)
exports.assignFaculty = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throw ApiError.notFound('Course not found');
  const { facultyId } = req.body;
  if (facultyId) await assertFaculty(facultyId);
  course.faculty = facultyId || null;
  await course.save();
  await course.populate('faculty', 'name email department');
  sendSuccess(res, course, facultyId ? 'Faculty assigned to course' : 'Faculty removed from course');
};

// POST /courses/:id/enroll  { studentIds: [...] }
exports.enroll = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throw ApiError.notFound('Course not found');
  const ids = [...new Set(req.body.studentIds.map(String))];
  const found = await User.countDocuments({ _id: { $in: ids }, role: 'student' });
  if (found !== ids.length) throw ApiError.badRequest('All studentIds must belong to existing students');
  await Course.updateOne({ _id: course._id }, { $addToSet: { students: { $each: ids } } });
  const updated = await Course.findById(course._id).populate('students', 'name rollNumber');
  sendSuccess(res, withCount(updated), 'Students enrolled successfully');
};

// DELETE /courses/:id/enroll/:studentId
exports.unenroll = async (req, res) => {
  const course = await Course.findById(req.params.id);
  if (!course) throw ApiError.notFound('Course not found');
  const wasEnrolled = course.students.some((s) => s.toString() === req.params.studentId);
  if (!wasEnrolled) throw ApiError.notFound('Student is not enrolled in this course');
  await Course.updateOne({ _id: course._id }, { $pull: { students: req.params.studentId } });
  sendSuccess(res, null, 'Student removed from course');
};

// GET /courses/:id/students (admin, or the faculty assigned to the course)
exports.students = async (req, res) => {
  const course = await getAccessibleCourse(req.params.id, req.user);
  if (req.user.role === 'student') throw ApiError.forbidden('Students cannot view the class list');
  await course.populate('students', 'name email rollNumber department phone');
  const sorted = [...course.students].sort((a, b) => (a.rollNumber || '').localeCompare(b.rollNumber || ''));
  sendSuccess(res, sorted, 'Enrolled students retrieved');
};
