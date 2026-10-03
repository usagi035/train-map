#!/usr/bin/env node
/**
 * dist/ に「アンインストーラ .exe」を同梱する。
 *
 * NSIS のアンインストーラは makensis のビルドだけでは作れず、インストーラを
 * 一度実行したときに WriteUninstaller が書き出す。そこで
 *   1) build/uninstaller.nsi を makensis でビルド(生成用インストーラ)
 *   2) それを /S で一度実行してアンインストーラを書き出させる
 *   3) dist/ へコピーして一時ファイルを削除する
 * という3段階を自動で行う。makensis は electron-builder が入れたものを使う。
 *
 * 使い方:  node scripts/make-uninstaller.js   (npm run dist でも呼ばれる)
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NSI = path.join(ROOT, 'build', 'uninstaller.nsi');
const OUT_DIR = path.join(ROOT, 'dist');
const UNINST_NAME = 'Uninstall RailwayMapEditor.exe';
const GENERATOR = 'make-uninstaller.exe';
// build/uninstaller.nsi の InstallDir と一致させること
const GENERATED_DIR = path.join(os.tmpdir(), 'RailwayMapEditorUninstGen');
const GENERATED_EXE = path.join(GENERATED_DIR, UNINST_NAME);

/** electron-builder がキャッシュした makensis.exe を探す */
function findMakensis() {
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'electron-builder', 'Cache'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'electron-builder', 'Cache'),
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith('nsis')) continue;
      const base = path.join(root, entry);
      const candidates = [
        path.join(base, 'makensis.exe'),
        path.join(base, 'Bin', 'makensis.exe'),
        ...fs.readdirSync(base, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => path.join(base, d.name, 'makensis.exe')),
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(NSI)) {
    throw new Error(`NSI スクリプトがありません: ${NSI}`);
  }

  const makensis = findMakensis();
  if (!makensis) {
    console.warn('[make-uninstaller] makensis が見つかりません(electron-builder のキャッシュ未生成?)。');
    console.warn('[make-uninstaller] 先に `npm run dist` を一度実行してください。アンインストーラの生成をスキップします。');
    return;
  }

  // 1) 生成用インストーラをビルド(OutFile が相対パスなので作業フォルダに入れる)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rme-uninst-build-'));
  try {
    fs.copyFileSync(NSI, path.join(work, path.basename(NSI)));
    console.log(`[make-uninstaller] makensis: ${makensis}`);
    execFileSync(makensis, [path.basename(NSI)], { cwd: work, stdio: 'inherit' });

    const generator = path.join(work, GENERATOR);
    if (!fs.existsSync(generator)) throw new Error(`生成用インストーラが作られませんでした: ${generator}`);

    // 2) 一回だけ実行してアンインストーラを書き出させる(何もインストールしない)
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
    execFileSync(generator, ['/S'], { stdio: 'ignore' });
    if (!fs.existsSync(GENERATED_EXE)) {
      throw new Error(`アンインストーラが書き出されませんでした: ${GENERATED_EXE}`);
    }

    // 3) dist/ へコピー
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dest = path.join(OUT_DIR, UNINST_NAME);
    fs.copyFileSync(GENERATED_EXE, dest);

    const bytes = fs.statSync(dest).size;
    console.log(`[make-uninstaller] dist/${UNINST_NAME} を生成しました (${(bytes / 1024).toFixed(0)} KB)`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
  }
}

try {
  main();
} catch (e) {
  console.error('[make-uninstaller] 失敗:', e.message);
  process.exit(1);
}
