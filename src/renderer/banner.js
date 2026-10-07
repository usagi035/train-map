/* ===========================================================================
   非ブロッキングの案内バナー(S4: タブ間の競合、S5: 自動保存の失敗)。
   - alert()/confirm() は画面を止めて編集のリズムを壊すので、通常の連絡はここから出す。
   - 文字は必ず `textContent` で入れ、ボタンの動作は `addEventListener` で繋ぐ。
     (CSP はインライン script・インラインハンドラを拒否しているため)
   - 名前(name)ごとに1枚。同じ名前で呼ぶと中身が入れ替わるので増え続けない。
   =========================================================================== */

const boxes = new Map();

function container() {
  let el = document.getElementById('banners');
  if (!el) {
    el = document.createElement('div');
    el.id = 'banners';
    document.body.appendChild(el);
  }
  return el;
}
// ライブリージョンは中身より先に存在している必要があるので、読み込み時に用意しておく
if (typeof document !== 'undefined' && document.body) container();

/**
 * 案内を出す。text は短く、actions は押したくなる順に。
 * actions = [{ label, onClick, close = true }](close:false で押しても消さない)
 */
export function setBanner(name, text, actions = [], cls = '') {
  let el = boxes.get(name);
  if (!el || !el.isConnected) {
    el = document.createElement('div');
    el.dataset.b = name;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    boxes.set(name, el);
    container().appendChild(el);
  }
  el.className = 'banner' + (cls ? ' ' + cls : '');
  el.textContent = '';
  const t = document.createElement('span');
  t.className = 'btext';
  t.textContent = text;
  el.appendChild(t);
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    b.addEventListener('click', () => { if (a.onClick) a.onClick(); if (a.close !== false) clearBanner(name); });
    el.appendChild(b);
  }
  return el;
}

export function clearBanner(name) {
  const el = boxes.get(name);
  if (!el) return;
  if (el.parentNode) el.parentNode.removeChild(el);
  boxes.delete(name);
}

export const hasBanner = name => {
  const el = boxes.get(name);
  return !!el && el.isConnected;
};
