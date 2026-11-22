const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ['Present', 'Absent'], required: true },
  },
  { timestamps: true }
);

// Index 1 (unique): one record per student, course and day. This is what blocks duplicates.
attendanceSchema.index({ student: 1, course: 1, date: 1 }, { unique: true });
// Index 2: the attendance sheet for a course on a date, and course history sorted by date.
attendanceSchema.index({ course: 1, date: -1 });

attendanceSchema.set('toJSON', {
  transform: (doc, ret) => { delete ret.__v; return ret; },
});

module.exports = mongoose.model('Attendance', attendanceSchema);
