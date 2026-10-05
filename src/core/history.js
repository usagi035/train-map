/* Undo / Redo(§5)。
   既存のスナップ方式(状態の JSON 文字列を積む)をそのまま使う。ここでは差し替えない。
   外部へは push / undo / redo / canUndo / canRedo だけを出し、UI は内部実装を知らない
   (将来的に Operation ベースへ入れ替えられる形にしてある)。 */

const undoStack = [];
const redoStack = [];
const HISTORY_MAX = 50;

let lastSnap = '';     // 最後に確定した(保存済みの)状態の文字列
let lastView = null;   // そのときの表示中の路線図と路線 { map, line }

// 起動時に呼ぶ
export function init(snapshot, view) {
  lastSnap = snapshot;
  lastView = view;
  undoStack.length = 0;
  redoStack.length = 0;
}
// 別ウィンドウからの取り込みなど、履歴を一から作り直すとき
export function reset(snapshot, view) { init(snapshot, view); }
// 表示中の路線図が切り替わったとき(「そのときの表示」を追従させる)
export function syncView(view) { lastView = view; }

// 確定した状態を積む。変更が無ければ積まない(false)
export function push(snapshot, view) {
  if (snapshot === lastSnap) return false;
  undoStack.push({ s: lastSnap, v: lastView });
  if (undoStack.length > HISTORY_MAX) undoStack.shift();
  redoStack.length = 0;
  lastSnap = snapshot;
  lastView = view;
  return true;
}
// 1つ戻す。戻すものが無ければ null。戻す先を「最後に確定した状態」として採用する
export function undo() {
  if (!undoStack.length) return null;
  redoStack.push({ s: lastSnap, v: lastView });
  const e = undoStack.pop();
  lastSnap = e.s;
  lastView = e.v;
  return e;
}
// 1つ進める
export function redo() {
  if (!redoStack.length) return null;
  undoStack.push({ s: lastSnap, v: lastView });
  const e = redoStack.pop();
  lastSnap = e.s;
  lastView = e.v;
  return e;
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
