const mongoose = require('mongoose');
const Announcement = require('../models/Announcement');
const Course = require('../models/Course');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { parsePagination, buildMeta, escapeRegex } = require('../utils/pagination');
const { getAssignedCourse } = require('../services/courseAccess');
const { appEvents, EVENTS } = require('../events/appEvents');

const POPULATE = [
  { path: 'createdBy', select: 'name role' },
  { path: 'course', select: 'courseCode courseName' },
];

// Which announcements may this user read? University-wide ones plus their own courses' ones.
async function visibilityFilter(user) {
  if (user.role === 'admin') return {};
  const field = user.role === 'faculty' ? { faculty: user._id } : { students: user._id };
  const ids = (await Course.find(field).select('_id')).map((c) => c._id);
  const or = [{ target: 'university' }, { target: 'course', course: { $in: ids } }];
  if (user.role === 'faculty') or.push({ createdBy: user._id });
  return { $or: or };
}

exports.list = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = await visibilityFilter(req.user);
  if (req.query.target) filter.target = req.query.target;
  if (req.query.course) filter.course = req.query.course;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$and = [{ $or: [{ title: rx }, { message: rx }] }];
  }
  const [items, total] = await Promise.all([
    Announcement.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(POPULATE),
    Announcement.countDocuments(filter),
  ]);
  sendSuccess(res, items, 'Announcements retrieved', 200, buildMeta(page, limit, total));
};

exports.get = async (req, res) => {
  const found = await Announcement.findById(req.params.id);
  if (!found) throw ApiError.notFound('Announcement not found');
  const visible = await Announcement.exists({ _id: found._id, ...(await visibilityFilter(req.user)) });
  if (!visible) throw ApiError.forbidden('You cannot view this announcement');
  await found.populate(POPULATE);
  sendSuccess(res, found);
};

exports.create = async (req, res) => {
  const { title, message, target, course } = req.body;
  if (target === 'course' && !course) throw ApiError.badRequest('course is required for course announcements');
  if (target === 'course' && !mongoose.isValidObjectId(course)) throw ApiError.badRequest('course must be a valid id');
  if (req.user.role === 'faculty') {
    if (target !== 'course') throw ApiError.forbidden('Faculty can only publish course announcements');
    await getAssignedCourse(course, req.user);
  } else if (target === 'course') {
    const exists = await Course.exists({ _id: course });
    if (!exists) throw ApiError.notFound('Course not found');
  }
  const announcement = await Announcement.create({
    title, message, target, course: target === 'course' ? course : null, createdBy: req.user._id,
  });
  appEvents.emit(EVENTS.ANNOUNCEMENT_CREATED, announcement);
  await announcement.populate(POPULATE);
  sendSuccess(res, announcement, 'Announcement published successfully', 201);
};

async function loadEditable(id, user) {
  const announcement = await Announcement.findById(id);
  if (!announcement) throw ApiError.notFound('Announcement not found');
  if (user.role === 'faculty' && announcement.createdBy.toString() !== user._id.toString()) {
    throw ApiError.forbidden('You can only modify your own announcements');
  }
  return announcement;
}

exports.update = async (req, res) => {
  const announcement = await loadEditable(req.params.id, req.user);
  if (req.body.title) announcement.title = req.body.title;
  if (req.body.message) announcement.message = req.body.message;
  await announcement.save();
  await announcement.populate(POPULATE);
  sendSuccess(res, announcement, 'Announcement updated successfully');
};

exports.remove = async (req, res) => {
  const announcement = await loadEditable(req.params.id, req.user);
  await announcement.deleteOne();
  sendSuccess(res, null, 'Announcement deleted successfully');
};
