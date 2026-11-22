const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');

const oid = (id) => new mongoose.Types.ObjectId(id.toString());

// Attendance percentage is always calculated on the backend, rounded to 2 decimals.
const percentage = (attended, total) => (total === 0 ? 0 : Math.round((attended / total) * 10000) / 100);

const presentCount = { $sum: { $cond: [{ $eq: ['$status', 'Present'] }, 1, 0] } };

// Aggregation 1: student-wise attendance per course (with percentage), joined to users & courses.
function studentWiseReport(match = {}, minPercent, maxPercent) {
  const pipeline = [
    { $match: match },
    { $group: { _id: { student: '$student', course: '$course' }, totalClasses: { $sum: 1 }, attended: presentCount } },
    {
      $addFields: {
        percentage: { $round: [{ $multiply: [{ $divide: ['$attended', '$totalClasses'] }, 100] }, 2] },
      },
    },
  ];
  const range = {};
  if (minPercent !== undefined) range.$gte = minPercent;
  if (maxPercent !== undefined) range.$lt = maxPercent;
  if (Object.keys(range).length) pipeline.push({ $match: { percentage: range } });
  pipeline.push(
    { $lookup: { from: 'users', localField: '_id.student', foreignField: '_id', as: 'student' } },
    { $lookup: { from: 'courses', localField: '_id.course', foreignField: '_id', as: 'course' } },
    { $unwind: '$student' },
    { $unwind: '$course' },
    {
      $project: {
        _id: 0,
        studentId: '$student._id',
        studentName: '$student.name',
        rollNumber: '$student.rollNumber',
        courseId: '$course._id',
        courseCode: '$course.courseCode',
        courseName: '$course.courseName',
        totalClasses: 1,
        attended: 1,
        percentage: 1,
      },
    },
    { $sort: { courseCode: 1, rollNumber: 1 } }
  );
  return Attendance.aggregate(pipeline);
}

// Aggregation 2: course-wise attendance (overall percentage, number of sessions and students).
function courseWiseReport(match = {}) {
  return Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$course',
        totalRecords: { $sum: 1 },
        presentRecords: presentCount,
        students: { $addToSet: '$student' },
        sessions: { $addToSet: '$date' },
      },
    },
    { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } },
    { $unwind: '$course' },
    {
      $project: {
        _id: 0,
        courseId: '$course._id',
        courseCode: '$course.courseCode',
        courseName: '$course.courseName',
        totalSessions: { $size: '$sessions' },
        studentsTracked: { $size: '$students' },
        totalRecords: 1,
        presentRecords: 1,
        averagePercentage: { $round: [{ $multiply: [{ $divide: ['$presentRecords', '$totalRecords'] }, 100] }, 2] },
      },
    },
    { $sort: { courseCode: 1 } },
  ]);
}

// Subject-wise summary for one student plus an overall figure.
async function studentSummary(studentId) {
  const rows = await studentWiseReport({ student: oid(studentId) });
  const totalClasses = rows.reduce((s, r) => s + r.totalClasses, 0);
  const attended = rows.reduce((s, r) => s + r.attended, 0);
  return {
    courses: rows.map((r) => ({
      courseId: r.courseId,
      courseCode: r.courseCode,
      courseName: r.courseName,
      totalClasses: r.totalClasses,
      classesAttended: r.attended,
      percentage: r.percentage,
    })),
    overall: { totalClasses, classesAttended: attended, percentage: percentage(attended, totalClasses) },
  };
}

module.exports = { oid, percentage, studentWiseReport, courseWiseReport, studentSummary };
