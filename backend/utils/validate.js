const mongoose = require('mongoose');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function checkField(name, value, rule) {
  const empty = value === undefined || value === null || value === '';
  if (empty) return rule.required ? `${name} is required` : null;
  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') return `${name} must be a string`;
      if (rule.min && value.trim().length < rule.min) return `${name} must be at least ${rule.min} characters`;
      if (rule.max && value.trim().length > rule.max) return `${name} must be at most ${rule.max} characters`;
      return null;
    case 'email':
      return typeof value === 'string' && EMAIL.test(value) ? null : `${name} must be a valid email`;
    case 'enum':
      return rule.values.includes(value) ? null : `${name} must be one of: ${rule.values.join(', ')}`;
    case 'date':
      return typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(value))
        ? null : `${name} must be a date in YYYY-MM-DD format`;
    case 'objectId':
      return mongoose.isValidObjectId(value) ? null : `${name} must be a valid id`;
    case 'array':
      return Array.isArray(value) ? null : `${name} must be an array`;
    default:
      return null;
  }
}

// validate({ body: { email: { type: 'email', required: true } }, query: {...}, params: {...} })
function validate(schema) {
  return (req, res, next) => {
    const errors = [];
    for (const source of ['body', 'params', 'query']) {
      const rules = schema[source];
      if (!rules) continue;
      for (const [field, rule] of Object.entries(rules)) {
        const message = checkField(field, req[source]?.[field], rule);
        if (message) errors.push({ field, message });
      }
    }
    if (errors.length) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors });
    }
    next();
  };
}

module.exports = validate;
