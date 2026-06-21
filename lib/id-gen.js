'use strict';
/** 既存ID配列から次のIDを生成。<prefix>-<4桁ゼロ詰め>。 */
function nextId(prefix, ids) {
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  let max = 0;
  for (const id of ids || []) {
    const m = String(id == null ? '' : id).match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return prefix + '-' + String(max + 1).padStart(4, '0');
}

module.exports = { nextId };
