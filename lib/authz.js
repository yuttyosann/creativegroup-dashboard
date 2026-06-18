'use strict';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** allowlist: [{email, role}] に対し、emailが含まれるか */
function isAllowed(email, allowlist) {
  const e = normalizeEmail(email);
  if (!e) return false;
  return allowlist.some((u) => normalizeEmail(u.email) === e);
}

module.exports = { isAllowed, normalizeEmail };
