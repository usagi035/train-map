/* =============================================================================
   S4(別タブからの上書きを止め、どちらを使うか選ばせる)のテスト。
   - 前半: 案内バナー部品(`banner.js`)を最小の DOM スタブで実際に動かして確かめる。
   - 中盤: 「相手の版で上書きしてよいか」の判定(ui-state)をスタブ付き import で実測する。
   - 後半: 画面側(renderer.js / index.html)の配線をソースで確かめる。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ---------- 最小の DOM スタブ(依存パッケージなし) ---------- */
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(), id: '', className: '', type: '', dataset: {}, attrs: {},
    children: [], parentNode: null, _text: '', listeners: {},
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    click() { (this.listeners.click || []).slice().forEach(fn => fn()); },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v); this.children = []; },
    get isConnected() { let n = this; while (n) { if (n === globalThis.document.body) return true; n = n.parentNode; } return false; }
  };
}
function makeDoc() {
  const body = makeEl('body');
  return {
    body,
    createElement: tag => makeEl(tag),
    getElementById(id) {
      const walk = n => {
        if (n.id === id) return n;
        for (const c of n.children) { const f = walk(c); if (f) return f; }
        return null;
      };
      return walk(body);
    },
    activeElement: null
  };
}

/* ---------- A. 案内バナー部品 ---------- */
globalThis.document = makeDoc();
const B = await import('../src/renderer/banner.js');
const box = () => document.getElementById('banners');

test('S4-1 バナーは role/aria-live を持ち、文字は textContent で入る', () => {
  assert.ok(box(), 'バナーの入れ物が用意されていない');
  const calls = [];
  B.setBanner('sync', '別のタブでこの路線図が変更されました。', [
    { label: '相手の版を読み込む', onClick: () => calls.push('load') },
    { label: '自分の版を残す', onClick: () => calls.push('keep') }
  ]);
  const el = box().children[0];
  assert.equal(el.attrs.role, 'status');
  assert.equal(el.attrs['aria-live'], 'polite');
  assert.equal(el.dataset.b, 'sync');
  const text = el.children.find(c => c.className === 'btext');
  assert.equal(text.textContent, '別のタブでこの路線図が変更されました。');
  const btns = el.children.filter(c => c.tagName === 'BUTTON');
  assert.deepEqual(btns.map(b => b.textContent), ['相手の版を読み込む', '自分の版を残す']);
  btns[0].click();
  assert.deepEqual(calls, ['load'], 'ボタンの動作が動かない');
  assert.equal(box().children.length, 0, '押したのにバナーが消えない');
  assert.equal(B.hasBanner('sync'), false);
  B.clearBanner('sync');
});

test('S4-2 同じ名前で呼んでも1枚に収まり、中身だけ入れ替わる', () => {
  B.setBanner('sync', '1回目');
  B.setBanner('sync', '2回目');
  assert.equal(box().children.length, 1, 'バナーが増えた');
  const el = box().children[0];
  assert.equal(el.children.find(c => c.className === 'btext').textContent, '2回目');
  B.clearBanner('sync');
  assert.equal(box().children.length, 0);
  assert.equal(B.hasBanner('sync'), false);
  // 消した後また出せる(新しい要素になる)
  B.setBanner('sync', '3回目');
  assert.equal(box().children.length, 1);
  B.clearBanner('sync');
});

test('S4-3 close:false のボタンは押しても消さない(後の操作を促す用途)', () => {
  let n = 0;
  B.setBanner('save', '保存に失敗しています。', [{ label: '書き出し', onClick: () => n++, close: false }]);
  const el = box().children[0];
  el.children.find(c => c.tagName === 'BUTTON').click();
  assert.equal(n, 1);
  assert.equal(box().children.length, 1, 'close:false なのに消えた');
  B.clearBanner('save');
});

test('S4-4 バナーはインラインハンドラ・innerHTML を使わない(CSP と衝突しない)', () => {
  const src = readFileSync(new URL('../src/renderer/banner.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML/.test(src), 'innerHTML を使っている');
  assert.ok(!/\bonclick\s*=/.test(src), 'インラインハンドラ属性を使っている');
  assert.ok(/addEventListener\('click'/.test(src), 'addEventListener で繋いでいない');
});

/* ---------- B. 「相手の版で上書きしてよいか」の判定 ---------- */
function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; }
  };
}

test('S4-5 判定: 保留中の保存・「自分の版を残す」の間は相手の版で上書きしない', async () => {
  globalThis.localStorage = makeStorage();
  globalThis.location = { hash: '' };
  globalThis.document = { getElementById: () => null };
  const M = await import('../src/renderer/ui-state.js');

  assert.equal(M.pendingSave(), false, '最初から保留中と出ている');
  assert.equal(M.shouldAskRemote(false), false, '何も無ければ自動適用(従来どおり)');

  M.deferSave();   // 編集中 = 保存が保留
  assert.equal(M.pendingSave(), true, '保留中の保存が見えていない');
  assert.equal(M.shouldAskRemote(false), true, '保留中に上書きしてしまっている');

  M.core.importDocument({ maps: [{ id: 'm9', name: '判定用', lines: [{ id: 'l9', name: 'L', color: '#334455', stations: [], crossings: [] }] }] });
  M.save();        // 保存が成功 → 保留は解け、通常の同期に戻る
  assert.equal(M.pendingSave(), false);
  assert.equal(M.shouldAskRemote(false), false, '保存成功後に同期できていない');

  M.keepLocalVersion();   // 「自分の版を残す」
  assert.equal(M.isLocalAuthority(), true);
  assert.equal(M.shouldAskRemote(false), true, '自分の版を残したのに相手の版を取り込んでしまう');

  M.core.importDocument({ maps: [{ id: 'ma', name: '上書きする', lines: [{ id: 'la', name: 'L', color: '#334455', stations: [], crossings: [] }] }] });
  M.save();        // 自分の保存が成功 = 保存領域は自分の版になった
  assert.equal(M.isLocalAuthority(), false, '自分の保存が成功したのに相手の版を拒否し続けている');
  assert.equal(M.shouldAskRemote(false), false);

  M.clearLocalAuthority();
  assert.equal(M.shouldAskRemote(true), true, 'ドラッグ中・入力中(busy)でも上書きしている');
  assert.equal(M.shouldAskRemote(false), false);
});

/* ---------- C. 画面側の配線 ---------- */
test('S4-6 storage ハンドラは「競合中は選ばせる / 平常時だけ適用」になっている', () => {
  const r = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
  assert.match(r, /hasBanner\('sync'\) \|\| shouldAskRemote\(localBusy\(\)\)/, '保留中の競合を考慮していない');
  assert.match(r, /function askRemote\(/, '保留の仕組みが無い');
  assert.match(r, /相手の版を読み込む/);
  assert.match(r, /自分の版を残す/);
  assert.match(r, /function applyRemote\(/, '読み込む動作が無い');
  assert.match(r, /clearLocalAuthority\(\);\s*\n\s*if \(raw\) applyRemote\(raw\)/, '読み込むときに権限を戻していない');
  // 入力中・ドラッグ中・道路描画中を「作業中」とみなす(保存の保留は shouldAskRemote の中)
  assert.match(r, /const localBusy = \(\) => !!drag \|\| !!ui\.drawing \|\| isTextEditing\(\)/);
  // 文書を入れ替えたら保留中の相手の版は捨てる(JSON読み込み)
  assert.match(r, /dropRemote\(\);\s+\/\/ 文書を入れ替えたので/, 'JSON読み込みで保留が残る');
  // 判定は ui-state 側(保存の保留と一体の場所)にある
  const u = readFileSync(new URL('../src/renderer/ui-state.js', import.meta.url), 'utf8');
  assert.match(u, /export const shouldAskRemote/);
  assert.match(u, /export const keepLocalVersion/);
  assert.match(u, /localAuthority = false; setSaveFailed\(false\); \} catch/, '保存成功で権限を戻していない');
  // バナーの見た目が index.html に在る
  const h = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(h, /#banners \{/, 'バナーのスタイルが無い');
  assert.match(h, /\.banner \{/, 'バナー本体のスタイルが無い');
});
