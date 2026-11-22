const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['admin', 'faculty', 'student'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, minlength: 2, maxlength: 100 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email'],
    },
    password: { type: String, required: [true, 'Password is required'], minlength: 6, select: false },
    role: { type: String, enum: ROLES, required: true },
    rollNumber: {
      type: String,
      trim: true,
      uppercase: true,
      required: [function () { return this.role === 'student'; }, 'Roll number is required for students'],
    },
    department: { type: String, trim: true, required: [true, 'Department is required'] },
    phone: { type: String, trim: true, match: [/^[0-9+\-\s]{7,15}$/, 'Please provide a valid phone number'] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Index 1: roll numbers are unique, but only among students (partial index ignores faculty/admin).
userSchema.index(
  { rollNumber: 1 },
  { unique: true, partialFilterExpression: { rollNumber: { $type: 'string' } } }
);
// Index 2: the list screens always filter by role and department.
userSchema.index({ role: 1, department: 1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
