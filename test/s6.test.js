/* =============================================================================
   S6(読み込みファイルの上限と、取り込みの型チェック)のテスト。
   - 上限値そのものは core/sanitize.js の LIMITS に集めたので直接確かめる。
   - 「読む前に弾いているか」は順序が命なので、renderer.js の出現順で検査する。
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LIMITS = (await import('../src/core/sanitize.js')).LIMITS;
const rsrc = readFileSync(new URL('../src/renderer/renderer.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** a の処理が b より先(= メモリを食う処理の前)に来ていること */
const before = (a, b, msg) => {
  const ia = rsrc.indexOf(a), ib = rsrc.indexOf(b);
  assert.ok(ia >= 0, `${msg}: ${a} が無い`);
  assert.ok(ib >= 0, `${msg}: ${b} が無い`);
  assert.ok(ia < ib, `${msg}: 「${a}」が「${b}」より後ろにある`);
};

test('S6-1 上限値は指示書の値(10MB / 15MB / 50メガピクセル)', () => {
  assert.equal(LIMITS.jsonFileBytes, 10_000_000, 'JSONの上限が10MBでない');
  assert.equal(LIMITS.imageFileBytes, 15_000_000, '画像の上限が15MBでない');
  assert.equal(LIMITS.imagePixels, 50_000_000, '画素数の上限が50MPでない');
  // S1 の data URL 上限は変えないこと(指示書: 形式は変えない)
  assert.equal(LIMITS.imageDataUrlBytes, 3_000_000);
});

test('S6-2 JSON は readAsText の前に、画像はデコードの前に必ず弾いている', () => {
  before('f.size > LIMITS.jsonFileBytes', 'r.readAsText(f)', 'JSONのサイズ検査');
  before('file.size > LIMITS.imageFileBytes', 'rd.readAsDataURL(file)', '画像のサイズ検査');
  before('nw * nh > LIMITS.imagePixels', "c.getContext('2d').drawImage", '画素数の検査');
  // 検査をすっとばして read へ進む経路が無いこと(return で抜ける)
  assert.match(rsrc, /if \(f\.size > LIMITS\.jsonFileBytes\) \{[^}]*e\.target\.value = ''; return;/s);
  assert.match(rsrc, /if \(file\.size > LIMITS\.imageFileBytes\) \{[^}]*return;/s);
  assert.match(rsrc, /if \(nw \* nh > LIMITS\.imagePixels\) \{[^}]*return;/s);
});

test('S6-3 画像は型の許可リストで確かめる(SVG は取り込めない)', () => {
  assert.match(rsrc, /const IMG_TYPES = \['image\/png', 'image\/jpeg', 'image\/jpg', 'image\/webp', 'image\/gif'\]/,
    '許可リストが無い、または S1 の許可リストと食い違う');
  assert.ok(!/IMG_TYPES = \[[^\]]*svg/.test(rsrc), '許可リストに SVG が入っている');
  // accept 属性だけに頼らない(= コードで型を見ている)
  assert.match(rsrc, /IMG_TYPES\.indexOf\(file\.type\) < 0/, '型の強制がコード側に無い');
  // SVG 専用の案内(勝手に捨てない)
  assert.match(rsrc, /image\/svg\+xml/);
  assert.match(rsrc, /SVG画像は取り込めません/);
  assert.match(html, /accept="image\/\*"/, 'input の accept が無い');
});

test('S6-4 上限を超えたときに読まない・描かない分岐が実際にある(順序と return)', () => {
  // 上限値が本体の処理より先に現れること(2つの検査が別々の場所にあること)
  assert.ok(rsrc.indexOf('LIMITS.jsonFileBytes') >= 0 && rsrc.indexOf('LIMITS.imageFileBytes') >= 0
            && rsrc.indexOf('LIMITS.imagePixels') >= 0, '上限値を使っていない');
  // 画像の取り込み経路が importImageFile の中に閉じている
  const s = rsrc.indexOf('function importImageFile');
  const e = rsrc.indexOf('document.getElementById(\'imgfile\')', s);
  assert.ok(s >= 0 && e > s, '取り込み関数が見当たらない');
  const body = rsrc.slice(s, e);
  for (const k of ['IMG_TYPES.indexOf', 'LIMITS.imageFileBytes', 'LIMITS.imagePixels']) {
    assert.ok(body.includes(k), `取り込み関数内に ${k} が無い`);
  }
});
