const User = require('../models/User');
const Course = require('../models/Course');
const Attendance = require('../models/Attendance');
const RefreshToken = require('../models/RefreshToken');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/response');
const { parsePagination, buildMeta, escapeRegex } = require('../utils/pagination');

const EDITABLE = ['name', 'email', 'password', 'rollNumber', 'department', 'phone', 'isActive'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

// One controller factory is used for both /students and /faculty because the logic is identical.
function makeUserController(role) {
  const label = role === 'student' ? 'Student' : 'Faculty member';

  const findOneOrFail = async (id) => {
    const user = await User.findOne({ _id: id, role });
    if (!user) throw ApiError.notFound(`${label} not found`);
    return user;
  };

  return {
    list: async (req, res) => {
      const { page, limit, skip } = parsePagination(req.query);
      const filter = { role };
      if (req.query.department) filter.department = req.query.department;
      if (req.query.q) {
        const rx = new RegExp(escapeRegex(req.query.q), 'i');
        filter.$or = [{ name: rx }, { email: rx }, { rollNumber: rx }];
      }
      const [items, total] = await Promise.all([
        User.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
        User.countDocuments(filter),
      ]);
      sendSuccess(res, items, `${label} list retrieved`, 200, buildMeta(page, limit, total));
    },

    get: async (req, res) => sendSuccess(res, await findOneOrFail(req.params.id)),

    create: async (req, res) => {
      const body = pick(req.body, EDITABLE);
      const user = await User.create({ ...body, role });
      sendSuccess(res, user, `${label} created successfully`, 201);
    },

    update: async (req, res) => {
      const user = await findOneOrFail(req.params.id);
      user.set(pick(req.body, EDITABLE));
      await user.save(); // save() (not findByIdAndUpdate) so validation and password hashing run
      sendSuccess(res, user, `${label} updated successfully`);
    },

    remove: async (req, res) => {
      const user = await findOneOrFail(req.params.id);
      if (role === 'student') {
        await Course.updateMany({ students: user._id }, { $pull: { students: user._id } });
        await Attendance.deleteMany({ student: user._id });
      } else {
        await Course.updateMany({ faculty: user._id }, { $set: { faculty: null } });
      }
      await RefreshToken.deleteMany({ user: user._id });
      await user.deleteOne();
      sendSuccess(res, null, `${label} deleted successfully`);
    },
  };
}

module.exports = { makeUserController };
