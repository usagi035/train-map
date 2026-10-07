/* 路線のセグメント計算と、踏切が位置を保つための再射影。
   純粋な関数: データを引数で受け取り結果を返す(§3)。グローバル状態には触れない。 */
import { clamp } from './model.js';

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 環状線(l.loop)は「最後の駅 → 最初の駅」の区間も1区間として数える
export const isLoop = l => !!l.loop && l.stations.length >= 2;
export const segCount = l => Math.max(0, isLoop(l) ? l.stations.length : l.stations.length - 1);
export const segA = (l, i) => l.stations[i];
export const segB = (l, i) => isLoop(l) ? l.stations[(i + 1) % l.stations.length] : l.stations[i + 1];
export const segPt = (l, seg, t) => {
  const a = segA(l, seg), b = segB(l, seg);
  if (!a) return { x: 0, y: 0 };
  if (!b) return { x: a.x, y: a.y };
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};
// 路線全体のどこに最も近いか(駅の追加位置の判定に使う)
export function project(l, p) {
  let best = null;
  for (let i = 0; i < segCount(l); i++) {
    const a = segA(l, i), b = segB(l, i);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { seg: i, t, d, x: q.x, y: q.y };
  }
  return best;
}
// 駅の追加・削除をしても、踏切が元の位置に残るよう付け直す
// ps を渡すと、それを位置の基準にする(環状線のON/OFFなど区間の数が変わるとき用)
export function keepCrossings(l, fn, ps) {
  if (!ps) ps = l.crossings.map(c => segPt(l, c.seg, c.t));
  fn();
  l.crossings = l.crossings.map((c, i) => {
    const r = project(l, ps[i]);
    return r ? Object.assign(c, { seg: r.seg, t: r.t }) : null;
  }).filter(Boolean);
}
