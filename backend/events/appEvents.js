const EventEmitter = require('events');

// A single shared emitter. Controllers/services emit events; listeners (events/listeners.js) react.
class AppEvents extends EventEmitter {}
const appEvents = new AppEvents();

const EVENTS = {
  ATTENDANCE_MARKED: 'attendanceMarked',
  ANNOUNCEMENT_CREATED: 'announcementCreated',
};

module.exports = { appEvents, EVENTS };
