const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/User');
const Course = require('../models/Course');
const Attendance = require('../models/Attendance');
const Announcement = require('../models/Announcement');
const RefreshToken = require('../models/RefreshToken');
const { toDayStart } = require('../utils/date');

// Last N weekdays (Mon-Fri) before today, oldest first.
function recentWeekdays(n) {
  const days = [];
  const d = new Date();
  while (days.length < n) {
    d.setDate(d.getDate() - 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(toDayStart(d.toISOString()));
  }
  return days.reverse();
}

async function seed() {
  await mongoose.connect(env.mongoUri);
  console.log('Connected. Clearing existing data...');
  await Promise.all([User, Course, Attendance, Announcement, RefreshToken].map((m) => m.deleteMany({})));
  // Collections were emptied, so make sure the declared indexes exist.
  await Promise.all([User, Course, Attendance, Announcement, RefreshToken].map((m) => m.syncIndexes()));

  // User.create() runs the pre-save hook, so every password is hashed with bcrypt.
  const admin = await User.create({ name: 'Dr. Meera Kapoor', email: 'admin@campus.edu', password: 'Admin@123', role: 'admin', department: 'Administration', phone: '9000000001' });

  const faculty = [];
  const facultyData = [
    ['Prof. Rajesh Verma', 'rajesh.verma@campus.edu', 'Computer Science', '9000000011'],
    ['Prof. Anita Sharma', 'anita.sharma@campus.edu', 'Mathematics', '9000000012'],
    ['Prof. Vikram Singh', 'vikram.singh@campus.edu', 'Physics', '9000000013'],
  ];
  for (const [name, email, department, phone] of facultyData) {
    faculty.push(await User.create({ name, email, password: 'Faculty@123', role: 'faculty', department, phone }));
  }

  const students = [];
  const studentData = [
    ['Aarav Mehta', 'aarav.mehta@campus.edu', 'CS2021001', 'Computer Science'],
    ['Diya Patel', 'diya.patel@campus.edu', 'CS2021002', 'Computer Science'],
    ['Kabir Khanna', 'kabir.khanna@campus.edu', 'CS2021003', 'Computer Science'],
    ['Isha Reddy', 'isha.reddy@campus.edu', 'MA2021001', 'Mathematics'],
    ['Rohan Gupta', 'rohan.gupta@campus.edu', 'PH2021001', 'Physics'],
  ];
  for (const [i, [name, email, rollNumber, department]] of studentData.entries()) {
    students.push(await User.create({ name, email, password: 'Student@123', role: 'student', rollNumber, department, phone: `90000001${20 + i}` }));
  }

  const [s1, s2, s3, s4, s5] = students;
  const [f1, f2, f3] = faculty;
  const courses = await Course.create([
    { courseCode: 'CS101', courseName: 'Data Structures', description: 'Arrays, linked lists, trees and graphs.', faculty: f1._id, students: [s1._id, s2._id, s3._id, s4._id] },
    { courseCode: 'CS201', courseName: 'Database Systems', description: 'Relational and NoSQL database design.', faculty: f1._id, students: [s1._id, s2._id, s5._id] },
    { courseCode: 'MA101', courseName: 'Linear Algebra', description: 'Vectors, matrices and linear transformations.', faculty: f2._id, students: [s1._id, s3._id, s4._id, s5._id] },
    { courseCode: 'PH101', courseName: 'Engineering Physics', description: 'Mechanics, waves and optics.', faculty: f3._id, students: [s2._id, s4._id, s5._id] },
  ]);

  // 8 past weekdays of attendance per course. A student is absent on a deterministic pattern
  // so percentages differ between students (and a couple fall below 75%).
  const days = recentWeekdays(8);
  const records = [];
  courses.forEach((course, ci) => {
    course.students.forEach((studentId) => {
      const si = students.findIndex((s) => s._id.equals(studentId));
      days.forEach((date, di) => {
        const absent = (di + si * 2 + ci) % (si + 3) === 0 && di % 2 === 1;
        records.push({ student: studentId, course: course._id, faculty: course.faculty, date, status: absent ? 'Absent' : 'Present' });
      });
    });
  });
  await Attendance.insertMany(records);

  await Announcement.create([
    { title: 'Welcome to the new semester', message: 'Classes begin on Monday. Please check your course list and timetable.', createdBy: admin._id, target: 'university' },
    { title: 'Library timings extended', message: 'The central library will stay open until 9 PM during the exam period.', createdBy: admin._id, target: 'university' },
    { title: 'Assignment 1 released', message: 'Assignment 1 on linked lists is due next Friday. Submit it in class.', createdBy: f1._id, target: 'course', course: courses[0]._id },
    { title: 'Quiz on matrices', message: 'A short quiz on matrix operations will be held in the next lecture.', createdBy: f2._id, target: 'course', course: courses[2]._id },
  ]);

  console.log(`Seeded: 1 admin, ${faculty.length} faculty, ${students.length} students, ${courses.length} courses, ${records.length} attendance records, 4 announcements.`);
  console.log('\nDemo credentials:');
  console.log('  Admin   : admin@campus.edu          / Admin@123');
  console.log('  Faculty : rajesh.verma@campus.edu   / Faculty@123  (also anita.sharma@..., vikram.singh@...)');
  console.log('  Student : aarav.mehta@campus.edu    / Student@123  (also diya.patel@..., kabir.khanna@..., isha.reddy@..., rohan.gupta@...)');
  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('Seeding failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
