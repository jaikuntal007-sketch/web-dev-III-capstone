const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true, maxlength: 150 },
    message: { type: String, required: [true, 'Message is required'], trim: true, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    target: { type: String, enum: ['university', 'course'], required: true },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      default: null,
      required: [function () { return this.target === 'course'; }, 'Course is required for course announcements'],
    },
  },
  { timestamps: true }
);

// Index: feed queries filter by target/course and sort newest first.
announcementSchema.index({ target: 1, course: 1, createdAt: -1 });

announcementSchema.set('toJSON', {
  transform: (doc, ret) => { delete ret.__v; return ret; },
});

module.exports = mongoose.model('Announcement', announcementSchema);
