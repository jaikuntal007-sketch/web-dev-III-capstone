// Attendance dates are stored as midnight UTC so one day == one value.
function toDayStart(input) {
  const d = new Date(`${String(input).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
module.exports = { toDayStart };
