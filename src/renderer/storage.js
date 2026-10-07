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
  maps:   NS + 'maps',    // 路線図そのもの(文書 JSON)
  open:   NS + 'open',    // 開いているタブのID一覧
  acc:    NS + 'acc',     // 右パネルの開閉状態
  panelw: NS + 'panelw'   // 左右サイドバーの幅
};

/** 移行前の旧キー。書込みは絶対にここでは行わない(読み取り専用)。 */
export const LEGACY = { maps: 'railmaps', open: 'railopen', acc: 'railacc', panelw: 'railpanelw' };
// TODO(旧キーの削除): 旧キーは今回のリリースでは残す(移行先の値が壊れていても旧データが消えないように)。
//       次に保存形式を変えるリリース(train-map:v2: へ上げるとき)に removeItem してよい。

const readRaw = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

/**
 * 旧キー → 新キーの移行(起動時に一度だけ呼ぶ)。
 * 「新キーが無くて旧キーにだけある」場合に限る(移行済みの値は上書きしない)。
 * 路線図は S1 のサニタイザを通してから移す。直せない文書なら移さず、旧キーを
 * そのまま残して起動側が初期状態で始める(データは消さない)。
 * 小さなUI設定は値が JSON として読めればそのまま移し、駄目なら移さない(既定値で始まる)。
 */
export function migrateLegacyKeys() {
  if (readRaw(KEYS.maps) == null && readRaw(LEGACY.maps) != null) {
    try {
      const raw = readRaw(LEGACY.maps);
      const { doc } = sanitizeDocument(JSON.parse(raw));
      write(KEYS.maps, JSON.stringify(doc));
    } catch (e) { /* 旧キーはそのまま残す */ }
  }
  for (const k of ['open', 'acc', 'panelw']) {
    if (readRaw(KEYS[k]) != null || readRaw(LEGACY[k]) == null) continue;
    try { JSON.parse(readRaw(LEGACY[k])); write(KEYS[k], readRaw(LEGACY[k])); }
    catch (e) { /* 使えなければ移さない */ }
  }
}
