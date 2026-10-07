/* =============================================================================
   S5(自動保存の失敗を、直るまで消さない知らせにする)のテスト。
   - 前半: localStorage が失敗する環境をスタブして ui-state を実際に動かす。
   - 後半: 文書本体の保存以外(表示だけの設定)が握りつぶされていることをソースで確かめる。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* ---------- 最小の DOM / window / localStorage スタブ(依存パッケージなし) ---------- */
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(), id: '', className: '', type: '', dataset: {}, attrs: {},
    children: [], parentNode: null, _text: '', listeners: {},
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { const a = this.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    click() { (this.listeners.click || []).slice().forEach(fn => fn()); },
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v); this.children = []; },
    get isConnected() { let n = this; while (n) { if (n === globalThis.document.body) return true; n = n.parentNode; } return false; }
  };
}
const body = makeEl('body');
const expBtn = makeEl('button'); expBtn.id = 'exp'; body.appendChild(expBtn);   // 書き出しボタン
globalThis.document = {
  body,
  createElement: t => makeEl(t),
  getElementById(id) {
    const walk = n => { if (n.id === id) return n; for (const c of n.children) { const f = walk(c); if (f) return f; } return null; };
    return walk(body);
  },
  activeElement: null
};
globalThis.window = { listeners: {}, addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
                      removeEventListener(t, fn) { const a = this.listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } };
globalThis.location = { hash: '' };

// 書き込みだけ失敗する localStorage(読み取りは正常に動く)
let failWrites = false;
const map = new Map();
globalThis.localStorage = {
  getItem: k => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
  removeItem: k => map.delete(k),
  clear: () => map.clear(),
  key: i => [...map.keys()][i] ?? null,
  get length() { return map.size; }
};

const M = await import('../src/renderer/ui-state.js');
const B = await import('../src/renderer/banner.js');
const banners = () => (document.getElementById('banners') ? document.getElementById('banners').children : []);
const bannerByName = n => banners().find(b => b.dataset.b === n);

test('S5-1 保存が成功している間は、バナーも beforeunload も出さない', () => {
  assert.equal(M.isSaveFailed(), false);
  assert.equal(bannerByName('savefail'), undefined, '成功しているのに失敗バナーが出ている');
  assert.equal((window.listeners.beforeunload || []).length, 0, '保存は成功しているのに閉じる確認を張っている');
});

test('S5-2 書き込みに失敗すると、赤い常駐バナーと beforeunload が出る(握りつぶさない)', () => {
  failWrites = true;
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  try {
    M.core.importDocument({ maps: [{ id: 'm1', name: '失敗テスト', lines: [{ id: 'l1', name: 'L', color: '#334455', stations: [], crossings: [] }] }] });
    M.save();
  } finally { console.warn = origWarn; }

  assert.equal(M.isSaveFailed(), true, '失敗フラグが立っていない');
  const b = bannerByName('savefail');
  assert.ok(b, '失敗バナーが出ていない');
  assert.match(b.className, /warn/);
  assert.match(b.textContent, /自動保存に失敗しています/);
  assert.match(b.textContent, /書き出し/);
  assert.equal((window.listeners.beforeunload || []).length, 1, '失敗中なのに beforeunload が無い');
  assert.ok(warns.length >= 1 && /自動保存に失敗/.test(warns.join('\n')), 'console.warn に残っていない');

  // バナーの「書き出し」ボタンは、常出の書き出しボタンを押す(close:false なのでバナーは残る)
  const btn = b.children.find(c => c.tagName === 'BUTTON');
  let clicked = 0;
  expBtn.addEventListener('click', () => clicked++);
  btn.click();
  assert.equal(clicked, 1, '書き出しボタンが動かない');
  assert.ok(bannerByName('savefail'), '書き出しても失敗バナーが消えてしまった');
});

test('S5-3 次の保存が成功したら、フラグ・バナー・beforeunload をすべて下ろす', () => {
  failWrites = false;
  M.core.importDocument({ maps: [{ id: 'm2', name: '回復テスト', lines: [{ id: 'l2', name: 'L', color: '#334455', stations: [], crossings: [] }] }] });
  M.save();
  assert.equal(M.isSaveFailed(), false, '保存が成功したのに失敗扱いが残っている');
  assert.equal(bannerByName('savefail'), undefined, '成功したのにバナーが残っている');
  assert.equal((window.listeners.beforeunload || []).length, 0, '成功したのに beforeunload が残っている');
  assert.ok(map.has('train-map:v1:maps'), '保存そのものが動いていない');
});

test('S5-4 旧キーの移行で書けなかった場合も、同じ知らせで始める', async () => {
  const S = await import('../src/renderer/storage.js');
  map.clear();
  map.set('railmaps', JSON.stringify({ maps: [{ id: 'm3', name: '移行', lines: [] }] }));  // 移行先が無い
  failWrites = true;
  assert.equal(S.migrateLegacyKeys(), false, '書けないのに成功と返している');
  failWrites = false;
  map.clear();
  assert.equal(S.migrateLegacyKeys(), true, '移行不要(=失敗なし)を失敗と返している');
});

test('S5-5 文書本体の保存は失敗を知らせ、表示だけの設定は理由付きで握りつぶす', () => {
  const u = readFileSync(new URL('../src/renderer/ui-state.js', import.meta.url), 'utf8');
  assert.match(u, /localStorage\.setItem\(KEYS\.maps, now\); localAuthority = false; setSaveFailed\(false\)/,
    '保存成功で失敗状態を解除していない');
  assert.match(u, /setSaveFailed\(true\);/, '保存失敗を通知していない');
  // 1回だけ alert して黙る方式(quotaWarned)は廃止した。ロック/非表示の alert は U2 の対象なので残っている
  assert.ok(!/quotaWarned/.test(u), '1回だけの alert 用フラグが残っている');

  const r = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
  assert.match(r, /setItem\(KEYS\.maps, e\.s\); setSaveFailed\(false\)/, 'undo/redo 後の保存が知らせられていない');
  assert.ok(!/setItem\(KEYS\.maps, e\.s\); \} catch \(err\) \{\}/.test(r), '文書保存の空の catch が残っている');
  assert.match(r, /幅は見た目だけの設定/, 'サイドバー幅を握りつぶす理由が書かれていない');

  // 握りつぶす側は「文書本体ではない」ことがコメントで明示されていること
  const t = readFileSync(new URL('../src/renderer/tabs.js', import.meta.url), 'utf8');
  assert.match(t, /文書本体ではない/, 'persistOpen の握りつぶしに理由が無い');
  const p = readFileSync(new URL('../src/renderer/side-panel.js', import.meta.url), 'utf8');
  assert.match(p, /文書本体ではない/, 'saveAcc の握りつぶしに理由が無い');
  // 文書本体の setItem が ui-state と renderer(applySnap)の2か所しかないこと
  const sites = [u, r].join('\n').match(/setItem\(KEYS\.maps/g) || [];
  assert.equal(sites.length, 2, `文書本体の保存先が想定と違う(${sites.length}か所)`);
});
