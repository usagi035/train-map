/* =============================================================================
   S2(CSP)の受入テスト。index.html の meta CSP を読み、
   script-src に 'unsafe-inline' が戻ってくるのを止める。
   ========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** meta CSP の content 属性を取り出す */
function csp() {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  assert.ok(m, 'index.html に CSP の meta が無い');
  return m[1];
}

/** directive 名 → 値(末尾のセミコロンは落とす) */
function directives(policy) {
  const out = {};
  for (const part of policy.split(';')) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name) out[name] = rest.join(' ');
  }
  return out;
}

test('S2-1 script-src に unsafe-inline が無い(インライン実行を止める)', () => {
  const d = directives(csp());
  assert.ok(d['script-src'], 'script-src が無い');
  assert.ok(!d['script-src'].includes("'unsafe-inline'"), `script-src が ${d['script-src']}`);
  assert.ok(!d['default-src'] || !d['default-src'].includes("'unsafe-inline'"));
  assert.equal(d['script-src'], "'self'", 'JS は同一オリジンの外部ファイルのみ');
});

test('S2-2 指示書のCSPがそのまま入っている(外部接続とbase/formを止める)', () => {
  const d = directives(csp());
  assert.equal(d['default-src'], "'none'");
  assert.equal(d['style-src'], "'self' 'unsafe-inline'", 'スタイルのインラインは維持(現状の緩和点)');
  assert.equal(d['img-src'], "'self' data:", '画像は同一オリジンと data: のみ');
  assert.equal(d['base-uri'], "'none'");
  assert.equal(d['form-action'], "'none'");
});

test('S2-3 インライン script は1本も無く、外部モジュールだけを読んでいないか', () => {
  // <script>…</script> の中身が空でない(=インライン実行)ものを探す
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => m[2].trim().length > 0);
  assert.deepEqual(inline.map(m => m[2].trim().slice(0, 40)), [],
    'インライン<script>があると CSP で弾かれる');
  // インラインのイベントハンドラ属性も無いこと
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*"/i, 'HTML にインラインイベントハンドラがある');
  assert.match(html, /<script type="module" src="\.\/src\/renderer\/renderer\.js"><\/script>/,
    'エントリの外部モジュールが無くなった');
});
