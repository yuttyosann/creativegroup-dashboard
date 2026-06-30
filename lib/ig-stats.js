'use strict';

/** 中央値。空配列は null。 */
function median(xs) {
  const a = xs.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** パーセンタイル（線形補間, p=0..100）。空配列は null。 */
function percentile(xs, p) {
  const a = xs.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** ペアリングして両方が有限数の組だけ残す。 */
function pairFinite(xs, ys) {
  const px = [];
  const py = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      px.push(x);
      py.push(y);
    }
  }
  return [px, py];
}

/** ピアソン相関。n<2 または分散0は null。 */
function pearson(xsRaw, ysRaw) {
  const [xs, ys] = pairFinite(xsRaw, ysRaw);
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

/** 順位（同値は平均順位）。 */
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1; // 1始まり
    for (let k = i; k <= j; k++) r[idx[k][1]] = avgRank;
    i = j + 1;
  }
  return r;
}

/** スピアマン相関。順位に変換してピアソン。 */
function spearman(xsRaw, ysRaw) {
  const [xs, ys] = pairFinite(xsRaw, ysRaw);
  if (xs.length < 2) return null;
  return pearson(ranks(xs), ranks(ys));
}

module.exports = { median, percentile, pearson, spearman };
