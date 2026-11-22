const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');
const Attendance = require('../models/Attendance');
const Announcement = require('../models/Announcement');
const { sendSuccess } = require('../utils/response');
const ApiError = require('../utils/ApiError');
const attendanceService = require('../services/attendanceService');

const { oid, percentage } = attendanceService;

// Faculty may only report on their own courses; admin may report on everything.
async function reportScope(req) {
  const match = {};
  if (req.user.role === 'faculty') {
    const ids = (await Course.find({ faculty: req.user._id }).select('_id')).map((c) => c._id);
    match.course = { $in: ids };
  }
  if (req.query.course) {
    if (match.course && !match.course.$in.map(String).includes(req.query.course)) {
      throw ApiError.forbidden('This course is not assigned to you');
    }
    match.course = oid(req.query.course);
  }
  return match;
}

// GET /reports/attendance/students?course=&below=75  (Aggregation 1)
exports.studentWise = async (req, res) => {
  const match = await reportScope(req);
  const below = req.query.below !== undefined ? Number(req.query.below) : undefined;
  const data = await attendanceService.studentWiseReport(match, undefined, Number.isNaN(below) ? undefined : below);
  sendSuccess(res, data, 'Student-wise attendance report generated');
};

// GET /reports/attendance/courses  (Aggregation 2)
exports.courseWise = async (req, res) => {
  const match = await reportScope(req);
  sendSuccess(res, await attendanceService.courseWiseReport(match), 'Course-wise attendance report generated');
};

// GET /reports/enrollment  (Aggregation 3: enrolment statistics with $facet)
exports.enrollment = async (req, res) => {
  const [result] = await Course.aggregate([
    {
      $facet: {
        courses: [
          { $lookup: { from: 'users', localField: 'faculty', foreignField: '_id', as: 'facultyDoc' } },
          {
            $project: {
              _id: 0,
              courseId: '$_id',
              courseCode: 1,
              courseName: 1,
              faculty: { $ifNull: [{ $arrayElemAt: ['$facultyDoc.name', 0] }, 'Unassigned'] },
              enrolledStudents: { $size: '$students' },
            },
          },
          { $sort: { enrolledStudents: -1, courseCode: 1 } },
        ],
        summary: [
          {
            $group: {
              _id: null,
              totalCourses: { $sum: 1 },
              totalEnrolments: { $sum: { $size: '$students' } },
              averagePerCourse: { $avg: { $size: '$students' } },
              unassignedCourses: { $sum: { $cond: [{ $eq: ['$faculty', null] }, 1, 0] } },
            },
          },
          { $project: { _id: 0, totalCourses: 1, totalEnrolments: 1, unassignedCourses: 1, averagePerCourse: { $round: ['$averagePerCourse', 1] } } },
        ],
        byDepartment: [
          { $unwind: '$students' },
          { $lookup: { from: 'users', localField: 'students', foreignField: '_id', as: 'student' } },
          { $unwind: '$student' },
          { $group: { _id: '$student.department', enrolments: { $sum: 1 } } },
          { $project: { _id: 0, department: '$_id', enrolments: 1 } },
          { $sort: { enrolments: -1 } },
        ],
      },
    },
  ]);
  sendSuccess(res, {
    courses: result.courses,
    summary: result.summary[0] || { totalCourses: 0, totalEnrolments: 0, averagePerCourse: 0, unassignedCourses: 0 },
    byDepartment: result.byDepartment,
  }, 'Enrolment statistics generated');
};

// GET /reports/dashboard  - real statistics for whichever role is logged in
exports.dashboard = async (req, res) => {
  const { user } = req;
  if (user.role === 'admin') {
    const [students, faculty, courses, announcements, enrol, att] = await Promise.all([
      User.countDocuments({ role: 'student' }),
      User.countDocuments({ role: 'faculty' }),
      Course.countDocuments(),
      Announcement.countDocuments(),
      Course.aggregate([{ $group: { _id: null, total: { $sum: { $size: '$students' } } } }]),
      Attendance.aggregate([{ $group: { _id: null, total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } } } }]),
    ]);
    return sendSuccess(res, {
      role: 'admin',
      students, faculty, courses, announcements,
      enrolments: enrol[0]?.total || 0,
      overallAttendance: percentage(att[0]?.present || 0, att[0]?.total || 0),
    });
  }
  if (user.role === 'faculty') {
    const courses = await Course.find({ faculty: user._id }).select('students');
    const ids = courses.map((c) => c._id);
    const uniqueStudents = new Set(courses.flatMap((c) => c.students.map(String)));
    const [att, sessions, announcements] = await Promise.all([
      Attendance.aggregate([{ $match: { course: { $in: ids } } }, { $group: { _id: null, total: { $sum: 1 }, present: { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } } } }]),
      Attendance.aggregate([{ $match: { course: { $in: ids } } }, { $group: { _id: { course: '$course', date: '$date' } } }, { $count: 'n' }]),
      Announcement.countDocuments({ createdBy: user._id }),
    ]);
    return sendSuccess(res, {
      role: 'faculty',
      courses: courses.length,
      students: uniqueStudents.size,
      classesHeld: sessions[0]?.n || 0,
      announcements,
      averageAttendance: percentage(att[0]?.present || 0, att[0]?.total || 0),
    });
  }
  const [courses, summary] = await Promise.all([
    Course.countDocuments({ students: user._id }),
    attendanceService.studentSummary(user._id),
  ]);
  const lowCourses = summary.courses.filter((c) => c.percentage < 75).length;
  sendSuccess(res, { role: 'student', courses, ...summary.overall, coursesBelow75: lowCourses });
};
