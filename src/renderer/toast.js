/* ===========================================================================
   一時的な知らせ(トースト)(U2)。
   - alert()/confirm() は画面を止めて編集のリズムを壊す。ここは「知って終わる」
     連絡を、既定5秒で自動的に消える形で出す。対応を促すときはボタンを添える
     (例: ロックの解除、削除の取り消し)。
   - `role="status"` `aria-live="polite"` で読み上げに流れ、CSP のため文字は
     `textContent`、動作は `addEventListener` で繋ぐ(インラインは使わない)。
   - `key` を付けると同じ知らせは1枚に置き換わる(連打で積み上がらない)。
   =========================================================================== */

const live = [];   // 表示中 { el, key, timer }

function host() {
  let el = document.getElementById('toasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toasts';
    document.body.appendChild(el);
  }
  return el;
}
// 読み上げは中身より先に存在している必要があるので、読み込み時に用意しておく
if (typeof document !== 'undefined' && document.body) host();

/**
 * 知らせを出す。text は短く、actions は押したくなる順に。
 * opts = { ms = 5000, actions = [{ label, onClick }], key = '', cls = '' }
 * 返り値は表示中の枠(toastCount() と合わせてテストで確かめる)。
 */
export function toast(text, opts = {}) {
  const ms = opts.ms == null ? 5000 : opts.ms;
  const key = opts.key || '';
  let item = key ? live.find(t => t.key === key) : null;
  if (!item) {
    const el = document.createElement('div');
    el.className = 'toast' + (opts.cls ? ' ' + opts.cls : '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    item = { el, key, timer: 0 };
    live.push(item);
    host().appendChild(el);
  }
  item.el.textContent = '';
  const t = document.createElement('span');
  t.className = 'ttext';
  t.textContent = text;
  item.el.appendChild(t);
  for (const a of (opts.actions || [])) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    b.addEventListener('click', () => { if (a.onClick) a.onClick(); dismiss(item); });   // 対応したら消える
    item.el.appendChild(b);
  }
  if (item.timer) clearTimeout(item.timer);
  item.timer = setTimeout(() => dismiss(item), ms);
  return item;
}

/** 表示中の知らせを消す(toast の戻り値、または key) */
export function dismiss(item) {
  const i = live.indexOf(item);
  if (i < 0) return;
  live.splice(i, 1);
  if (item.timer) clearTimeout(item.timer);
  if (item.el.parentNode) item.el.parentNode.removeChild(item.el);
}
export function dismissToast(key) {
  const it = live.find(t => t.key === key);
  if (it) dismiss(it);
}
export const toastCount = () => live.length;
export const hasToast = key => live.some(t => t.key === key);
