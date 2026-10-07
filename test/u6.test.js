/* =============================================================================
   U6(画像の書き出し品質: 1×/2×/3×・背景の透過・選択枠の非表示・SVG・revoke 遅延)のテスト。
   書き出しは DOM(クローン・canvas・Blob)が要なので、次の2つで確かめる。
   - 決めた作りになっているか = ソースの検査(クローンだけを書き換える / 即時 revoke が無い など)
   - 実際に書き出せるか = ブラウザでの手動確認(下のコメントと decisions 項目27)
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('index.html');
const rsrc = read('src/renderer/renderer.js');
const canvasSrc = read('src/renderer/canvas.js');

/** `{ }` で囲まれた関数の中身を抜き出す(コメント中の波括弧も数えてしまうが、対で閉じるので影響しない) */
function bodyOf(src, head) {
  const i = src.indexOf(head);
  assert.ok(i >= 0, '見つからない: ' + head);
  const a = src.indexOf('{', i);
  let d = 0;
  for (let j = a; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  assert.fail('閉じ括弧が見つからない: ' + head);
}
/** `#exppop` の CSS(ルールの中身) */
const cssOf = sel => {
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const i = css.indexOf(sel);
  assert.ok(i >= 0, `CSS が無い: ${sel}`);
  const a = css.indexOf('{', i), b = css.indexOf('}', a);
  return css.slice(a + 1, b);
};

test('U6-1 書き出しに 1×/2×/3×・背景の透過・PNG/SVG の選択肢がある', () => {
  // --- UI(index.html)
  assert.match(html, /id="exppop" hidden/, '書き出し設定のポップアップが無い');
  assert.match(html, /id="expimg"[^>]*aria-expanded="false"[^>]*aria-controls="exppop"/,
    '開閉が aria で伝わっていない');
  for (const v of [1, 2, 3]) {
    assert.ok(new RegExp(`name="expsize" value="${v}"`).test(html), `${v}× の選択肢が無い`);
  }
  assert.match(html, /name="expsize" value="1" checked/, '既定の倍率が 1× でない(従来の大きさが変わる)');
  assert.match(html, /type="checkbox" id="exptrans"[^>]*>[^<]*背景を透過|id="exptrans">背景を透過/,
    '背景を透過にする選択肢が無い');
  assert.match(html, /id="exppng"/, 'PNG の書き出しボタンが無い');
  assert.match(html, /id="expsvg"/, 'SVG の書き出しボタンが無い');
  assert.match(cssOf('#exppop[hidden]'), /display:none/, '閉じたときもポップアップが残る');
  assert.match(cssOf('#exppop {'), /position:absolute/, 'ポップアップの置き場所が決まっていない');

  // --- 配線(renderer.js)
  assert.match(rsrc, /function setExpPop\(on\)/, '開閉関数が無い');
  assert.match(rsrc, /setAttribute\('aria-expanded', on \? 'true' : 'false'\)/, 'aria-expanded を更新していない');
  assert.match(rsrc, /if \(b\.id === 'expimg'\) \{\s*\r?\n\s*e\.stopPropagation\(\);/,
    '押した直後に「外側を押すと閉じる」へ届いて閉まってしまう');
  assert.match(rsrc, /!exppop\.contains\(e\.target\)\) setExpPop\(false\)/, '外側を押しても閉じない');
  assert.match(rsrc, /e\.key === 'Escape' && !exppop\.hidden/, 'Esc で閉じられない');
  assert.match(rsrc, /getElementById\('exppng'\)\.addEventListener\('click'/, 'PNG ボタンが繋がっていない');
  assert.match(rsrc, /getElementById\('expsvg'\)\.addEventListener\('click'/, 'SVG ボタンが繋がっていない');
  // 倍率は必ず 1〜3 に収める(壊れた値で canvas が巨大にならないように)
  const scale = bodyOf(rsrc, 'const expScale = () =>');
  assert.match(scale, /n >= 1 && n <= 3 \? n : 1/, '倍率を範囲に収めていない');
});

test('U6-2 選択の枠は「クローン側だけ」を取り除く(生きているキャンバスは書き換えない)', () => {
  // --- どの要素が「書き出しに出さない枠」かを描画側で明示している
  const marks = (canvasSrc.match(/data-chrome="1"/g) || []).length;
  assert.ok(marks >= 10, `選択枠の印が足りない(${marks}個)。増やしたら書き出し側の検査も直す`);
  assert.match(canvasSrc, /const mkBox = .*data-chrome="1"/, '□で選んだ要素の枠に印がない');
  assert.match(canvasSrc, /<rect data-chrome="1" x="\$\{num\(bandBox\.x0\)\}"/, '□の枠(バンド)に印がない');
  assert.match(canvasSrc, /道路ツール|描画中プレビュー/, '描画中プレビューの説明が無い');
  assert.match(canvasSrc, /`<polyline data-chrome="1" points="\$\{all\.map/, '描画中プレビューに印がない');
  // 背景の四角は「透過」で消す対象として別の印にする
  assert.match(canvasSrc, /<rect data-bg="1" width=/, '背景の四角に印がない');

  // --- 書き出しはクローンに対してしか触れない
  const clone = bodyOf(rsrc, 'function exportClone(');
  assert.match(clone, /cloneNode\(true\)/, 'クローンを作らず生きているキャンバスを使っている');
  assert.match(clone, /clone\.querySelectorAll\('\[data-chrome\]'\)\.forEach\(n => n\.remove\(\)\)/,
    'クローンから選択枠を取り除いていない');
  assert.match(clone, /clone\.querySelector\('\[data-bg\]'\)/, '透過のときに背景を取り除いていない');
  assert.ok(!/innerHTML|ui\.sel\s*=|renderCanvas\(\)/.test(clone), '生きているキャンバスを書き換えている');
  assert.ok(!/document\.getElementById\('cv'\)\.(innerHTML|replaceChildren)/.test(rsrc), 'キャンバスを直接書き換えている');

  const exp = bodyOf(rsrc, 'function exportImage(');
  assert.ok(!/ui\.sel\s*=|renderCanvas\(\)|innerHTML/.test(exp), '書き出しの間に画面を描き直している(= 生きているキャンバスを書き換える)');
  assert.match(exp, /exportClone\(scale, transparent\)/, 'クローンを作らずに書き出している');
});

test('U6-3 SVG を書き出せる(単体で開ける形にする)', () => {
  const exp = bodyOf(rsrc, 'function exportImage(');
  assert.match(exp, /kind === 'svg'/, 'SVG の分岐が無い');
  assert.match(exp, /image\/svg\+xml;charset=utf-8/, 'SVG として読める型で保存していない');
  assert.match(exp, /safeFilename\(m\.name\) \+ '\.svg'/, 'SVG のファイル名が未加工');
  // xmlns が無ければ足す(SVG は HTML から書体を継承するので、単体では font-family が要る)
  const text = bodyOf(rsrc, 'function svgText(');
  assert.match(text, /XMLSerializer/, '直列化していない');
  assert.match(text, /xmlns=/, 'xmlns を確かめていない');
  assert.match(text, /replace\(\/\^<svg\\b\/, '<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"'\)/,
    '足りないときの xmlns の補完が無い');
  assert.match(bodyOf(rsrc, 'function exportClone('), /setAttribute\('font-family', getComputedStyle\(document\.body\)\.fontFamily\)/,
    '書体を埋め込んでいない(SVG は HTML の書体を継承しない)');
});

test('U6-4 PNG は選んだ倍率で書き出し、透過なら背景を塗らない', () => {
  const exp = bodyOf(rsrc, 'function exportImage(');
  assert.match(exp, /document\.getElementById\('exptrans'\)\.checked/, '透過の選択を読んでいない');
  assert.match(exp, /if \(!transparent\) \{ ctx\.fillStyle = m\.bg \|\| BG; ctx\.fillRect\(/,
    '透過のときも背景を塗っている');
  assert.match(exp, /canvas\.width = w \* scale; canvas\.height = h \* scale/, '倍率が canvas の大きさに効いていない');
  assert.match(exp, /ctx\.drawImage\(img, 0, 0, canvas\.width, canvas\.height\)/, '選んだ大きさで描いていない');
  assert.match(exp, /'image\/png'/, 'PNG として保存していない');
  assert.match(exp, /safeFilename\(m\.name\) \+ '\.png'/, 'PNG のファイル名が未加工');
  // 解像度はマップの大きさ × 倍率。ズーム(表示倍率)に引きずられないこと
  const clone = bodyOf(rsrc, 'function exportClone(');
  assert.match(clone, /setAttribute\('width', w \* scale\)/, 'SVG の幅が倍率になっていない(ぼやける)');
  assert.match(clone, /setAttribute\('viewBox', `0 0 \$\{w\} \$\{h\}`\)/, 'viewBox がマップの座標になっていない');
});

test('U6-5 object URL はダウンロード開始後に遅れて捨てる(JSON / PNG / SVG すべて)', () => {
  const dl = bodyOf(rsrc, 'function download(');
  assert.match(dl, /setTimeout\(\(\) => URL\.revokeObjectURL\(u\), 1000\)/, 'revoke が即時(または無い)');
  assert.ok(!/a\.click\(\);\s*URL\.revokeObjectURL\(/.test(rsrc), 'a.click() の直後に revoke している(失敗するブラウザがある)');
  // 3つの書き出しすべてがこの経由を通る
  const uses = (rsrc.match(/\bdownload\(/g) || []).length;
  assert.ok(uses >= 4, `download() の呼び出しが足りない(${uses}個 = 定義+JSON+PNG+SVG)`);
  assert.match(rsrc, /download\(new Blob\(\[JSON\.stringify/, 'JSON 書き出しが共通経由でない');
  assert.match(rsrc, /download\(new Blob\(\[svgText\(clone\)\]/, 'SVG 書き出しが共通経由でない');
  assert.match(rsrc, /download\(blob, safeFilename\(m\.name\) \+ '\.png'\)/, 'PNG 書き出しが共通経由でない');
});
