const { appEvents, EVENTS } = require('./appEvents');
const notificationService = require('../services/notificationService');

// All reactions to application events live here, so controllers stay free of notification logic.
function registerListeners() {
  appEvents.on(EVENTS.ATTENDANCE_MARKED, async (payload) => {
    try {
      console.log(
        `[event] ${EVENTS.ATTENDANCE_MARKED}: ${payload.courseCode} on ${payload.date} (${payload.records.length} students)`
      );
      await notificationService.notifyAttendanceMarked(payload);
    } catch (err) {
      console.error(`[event] ${EVENTS.ATTENDANCE_MARKED} handler failed:`, err.message);
    }
  });

  appEvents.on(EVENTS.ANNOUNCEMENT_CREATED, async (announcement) => {
    try {
      console.log(`[event] ${EVENTS.ANNOUNCEMENT_CREATED}: "${announcement.title}" (${announcement.target})`);
      await notificationService.notifyAnnouncement(announcement);
    } catch (err) {
      console.error(`[event] ${EVENTS.ANNOUNCEMENT_CREATED} handler failed:`, err.message);
    }
  });
}

module.exports = registerListeners;
