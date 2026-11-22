function parsePagination(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 100);
  return { page, limit, skip: (page - 1) * limit };
}

function buildMeta(page, limit, total) {
  return { page, limit, total, pages: Math.ceil(total / limit) || 1 };
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { parsePagination, buildMeta, escapeRegex };
