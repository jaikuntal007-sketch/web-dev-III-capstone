const User = require('../models/User');
const Course = require('../models/Course');
const { getIO, userRoom } = require('../sockets/io');

function emitToUsers(userIds, eventName, payload) {
  const io = getIO();
  if (!io) return;
  userIds.forEach((id) => io.to(userRoom(id.toString())).emit(eventName, payload));
}

// Who should see an announcement?
// - university: every active user except the author
// - course: the course's faculty and enrolled students (except the author)
async function getAnnouncementRecipients(announcement) {
  const authorId = announcement.createdBy.toString();
  let ids = [];
  if (announcement.target === 'university') {
    const users = await User.find({ isActive: true }).select('_id');
    ids = users.map((u) => u._id.toString());
  } else {
    const course = await Course.findById(announcement.course).select('faculty students');
    if (course) {
      ids = [...course.students.map(String)];
      if (course.faculty) ids.push(course.faculty.toString());
    }
  }
  return [...new Set(ids)].filter((id) => id !== authorId);
}

async function notifyAnnouncement(announcement) {
  const recipients = await getAnnouncementRecipients(announcement);
  emitToUsers(recipients, 'announcement:new', {
    id: announcement._id,
    title: announcement.title,
    message: announcement.message,
    target: announcement.target,
    course: announcement.course,
    createdAt: announcement.createdAt,
  });
}

// Each student only receives their own status. Classmates' records are never sent.
async function notifyAttendanceMarked({ courseId, courseCode, date, records }) {
  const io = getIO();
  if (!io) return;
  records.forEach((r) => {
    io.to(userRoom(r.student.toString())).emit('attendance:marked', {
      courseId, courseCode, date, status: r.status,
    });
  });
}

module.exports = { notifyAnnouncement, notifyAttendanceMarked, getAnnouncementRecipients };
