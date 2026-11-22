const Course = require('../models/Course');
const ApiError = require('../utils/ApiError');

const isAssignedFaculty = (course, user) => !!course.faculty && course.faculty.toString() === user._id.toString();
const isEnrolled = (course, user) => course.students.some((s) => s.toString() === user._id.toString());

// Loads a course and checks that the user is allowed to see it. Throws 404/403 otherwise.
async function getAccessibleCourse(courseId, user) {
  const course = await Course.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found');
  if (user.role === 'admin') return course;
  if (user.role === 'faculty' && isAssignedFaculty(course, user)) return course;
  if (user.role === 'student' && isEnrolled(course, user)) return course;
  throw ApiError.forbidden('You do not have access to this course');
}

// For faculty-only operations: the course must be assigned to this faculty member.
async function getAssignedCourse(courseId, user) {
  const course = await Course.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found');
  if (!isAssignedFaculty(course, user)) throw ApiError.forbidden('This course is not assigned to you');
  return course;
}

module.exports = { getAccessibleCourse, getAssignedCourse, isAssignedFaculty, isEnrolled };
