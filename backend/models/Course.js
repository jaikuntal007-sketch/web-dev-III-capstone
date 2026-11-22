const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    courseCode: { type: String, required: [true, 'Course code is required'], unique: true, uppercase: true, trim: true },
    courseName: { type: String, required: [true, 'Course name is required'], trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

// Index: "which courses does this faculty teach / this student attend" is a hot query.
courseSchema.index({ faculty: 1 });
courseSchema.index({ students: 1 });

courseSchema.set('toJSON', {
  transform: (doc, ret) => { delete ret.__v; return ret; },
});

module.exports = mongoose.model('Course', courseSchema);
