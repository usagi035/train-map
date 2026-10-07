/* ===========================================================================
   localStorage のキー管理(S3: 名前空間つきキー + 旧キーからの移行)。
   - 定数 NS だけを唯一の出所とし、画面側の各モジュールはここを import する。
   - 同じオリジン(例: github.io)には他の公開物も置けるので、短く汎用的な
     キー名(railmaps など)は使わない。
   - 移行のとき**旧キーは残す**。同じリリースでデータを捨てないため。
   =========================================================================== */
import { sanitizeDocument } from '../core/sanitize.js';

/** すべてのキーの先頭につける名前空間(バージョン付き。破壊的な変更のときだけ上げる) */
export const NS = 'train-map:v1:';

export const KEYS = {
  maps:    NS + 'maps',     // 路線図そのもの(文書 JSON)
  open:    NS + 'open',     // 開いているタブのID一覧
  acc:     NS + 'acc',      // 右パネルの開閉状態
  panelw:  NS + 'panelw',   // 左右サイドバーの幅
  updated: NS + 'updated',  // 路線図ごとの最終更新時刻(U5)。**文書本体には足さない**:
                            //   書き出しの JSON 形式を変えないため、別のキーに持つ
  view:    NS + 'view'      // 路線図ごとのズーム・スクロール位置(U7)。**同じ理由で文書には足さない**
};

/** 移行前の旧キー。書込みは絶対にここでは行わない(読み取り専用)。 */
export const LEGACY = { maps: 'railmaps', open: 'railopen', acc: 'railacc', panelw: 'railpanelw' };
// TODO(旧キーの削除): 旧キーは今回のリリースでは残す(移行先の値が壊れていても旧データが消えないように)。
//       次に保存形式を変えるリリース(train-map:v2: へ上げるとき)に removeItem してよい。

const readRaw = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

/**
 * 旧キー → 新キーの移行(起動時に一度だけ呼ぶ)。
 * 戻り値: すべて成功(または移行不要)なら true。**書こうとして失敗したなら false**
 * (= 書けない環境なので、呼び出し側が「保存失敗」を知らせる。S5)。
 * 「新キーが無くて旧キーにだけある」場合に限る(移行済みの値は上書きしない)。
 * 路線図は S1 のサニタイザを通してから移す。直せない文書なら移さず、旧キーを
 * そのまま残して起動側が初期状態で始める(データは消さない)。
 * 小さなUI設定は値が JSON として読めればそのまま移し、駄目なら移さない(既定値で始まる)。
 */
export function migrateLegacyKeys() {
  let ok = true;
  if (readRaw(KEYS.maps) == null && readRaw(LEGACY.maps) != null) {
    try {
      const raw = readRaw(LEGACY.maps);
      const { doc } = sanitizeDocument(JSON.parse(raw));
      ok = write(KEYS.maps, JSON.stringify(doc)) && ok;
    } catch (e) { /* 読めない文書は移さない(旧キーのまま)。「読めたのに書けない」失敗ではないので ok は変えない */ }
  }
  for (const k of ['open', 'acc', 'panelw']) {
    if (readRaw(KEYS[k]) != null || readRaw(LEGACY[k]) == null) continue;
    try { JSON.parse(readRaw(LEGACY[k])); ok = write(KEYS[k], readRaw(LEGACY[k])) && ok; }
    catch (e) { /* 値が読めなければ移さない(各所が既定値で始める) = 失敗ではない */ }
  }
  return ok;
}

/* ---------- 見かけの位置(ズーム・スクロール)を路線図ごとに覚える(U7) ----------
   文書本体には足さない = **書き出しの JSON 形式を変えない**(S3 の DoD と同じ考え方)。
   表示だけの情報なので、読めなくても書けなくても握りつぶす(保存失敗の知らせにはしない)。
   読み込みは毎回 fresh に(別タブが書き換えても上書きで消さないため)。 */
/** その路線図の記憶 { z, l, t }。無ければ null */
export function mapView(id) {
  if (!id) return null;
  let all = null;
  try { all = JSON.parse(readRaw(KEYS.view)); } catch (e) { all = null; }
  const v = all && typeof all === 'object' ? all[id] : null;
  if (!v || typeof v !== 'object' || !Number.isFinite(v.z)) return null;
  return { z: v.z, l: Number.isFinite(v.l) ? v.l : 0, t: Number.isFinite(v.t) ? v.t : 0 };
}
/** 見かけの位置を覚える(前と同じなら書かない = スクロールのたびに書き込まない) */
export function saveMapView(id, z, l, t) {
  if (!id || !Number.isFinite(z)) return;
  let all = null;
  try { all = JSON.parse(readRaw(KEYS.view)); } catch (e) { all = null; }
  if (!all || typeof all !== 'object' || Array.isArray(all)) all = {};
  const n = { z, l: Number.isFinite(l) ? l : 0, t: Number.isFinite(t) ? t : 0 };
  const cur = all[id];
  if (cur && cur.z === n.z && cur.l === n.l && cur.t === n.t) return;
  all[id] = n;
  write(KEYS.view, JSON.stringify(all));
}
/** その路線図を消したときに、覚えている位置も消す */
export function forgetMapView(id) {
  if (!id) return;
  let all = null;
  try { all = JSON.parse(readRaw(KEYS.view)); } catch (e) { all = null; }
  if (!all || typeof all !== 'object' || !(id in all)) return;
  delete all[id];
  write(KEYS.view, JSON.stringify(all));
}
