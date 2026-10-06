# 路線図エディタ（railway-map-editor）Web版移植 作業指示書

## 1. 概要・目的
本指示書は、現在 Electron で動作している「路線図エディタ（railway-map-editor v1.0.0）」を、サーバーやインストーラを必要としない**純粋なフロントエンドWebアプリケーション（Web版）へ移植・最適化する**ための改修手順と要件を定義するものです。

---

## 2. 移植基本方針
1. **既存資産の最大活用**
   - 画面描画（SVG/CSS）およびコアロジック（`src/core/`, `src/renderer/`）はWeb標準技術（HTML/CSS/ES Modules）で書かれているため、**原則としてロジックは変更せずそのまま活用**します。
2. **Electron依存の完全排除**
   - メインプロセス（`src/main/main.js`）および NSIS アンインストーラ関連スクリプトを削除・切り離します。
3. **ブラウザ標準挙動への適合**
   - ブラウザで制限されるショートカットキー（`Ctrl+W` 等）や、複数タブ起動時の競合制御をWeb標準APIに置き換えます。

---

## 3. 具体的な作業手順・変更内容

### タスク1: 不要ファイル・依存関係の整理
- **削除対象ファイル/フォルダ**:
  - `src/main/` （メインプロセス）
  - `scripts/make-uninstaller.js`
  - `build/uninstaller.nsi`
  - `scripts/up.bat`
- **`package.json` の改修**:
  - `electron`, `electron-builder` 等の依存パッケージを削除。
  - 開発用ローカルサーバー起動コマンド（例: `vite` や `http-server`）を追加。

---

### タスク2: キーボードショートカットの調整
ブラウザでは `Ctrl + W` は「ブラウザのタブを閉じる」標準機能であり、JavaScript側で捕捉・制御することが推奨されない（または無効化される）ため調整します。

- **対象コード**: `src/renderer/renderer.js` / `src/main/main.js`（削除）
- **変更内容**:
  - `Ctrl + W` による「アプリ内路線図タブの削除」ショートカットを廃止、または **`Alt + W`** や **`Ctrl + Shift + W`** へ変更。
  - 画面UI上の「✕（タブを閉じる）」ボタンや `Esc` キー操作での離脱導線を明確化。

---

### タスク3: 複数タブ起動時のデータ競合防止（タブ間連携）
Electronでは `app.requestSingleInstanceLock()` により二重起動を防いでいましたが、Web版では同一ブラウザで複数タブが開かれる可能性があります。

- **対象コード**: `src/renderer/renderer.js` (5.14節 `storage` 同期周辺)
- **変更内容**:
  - 既存の `window.addEventListener('storage', ...)` による更新同期を維持。
  - `BroadcastChannel` API を導入し、別タブで同じ路線図が保存された際に、「別のタブで変更されました。リロードしますか？」の通知ダイアログを表示、または自動同期する仕組みを強化。

---

### タスク4: エクスポート・インポート機能のブラウザ最適化
- **JSONファイル読み込み/保存**:
  - `FileReader` API および Blob / `<a download>` によるファイルダウンロード処理が正常に動作することを確認（基本改修不要）。
- **画像出力（PNGエクスポート）**:
  - `exportImage()` 内で Canvas / SVGSerializer を使用した画像生成が、主要ブラウザ（Chrome, Firefox, Edge, Safari）で崩れず動作するか検証。

---

### タスク5: Web公開用ビルド/配信構成の作成
- **構成案A: ビルドツールなし（純粋な静的ファイル配置）**
  - `src/ui/index.html` をルート直下の `index.html` に配置またはパス調整を行い、GitHub Pages や Cloudflare Pages 等にそのままデプロイできるようにする。
- **構成案B: Vite 等のバンドラー導入（推奨）**
  - JSモジュールのバンドルと最適化を行い、単一の配信用フォルダ（`dist/`）を出力する構成にする。

---

## 4. ディレクトリ構造（移行後イメージ）

```text
railway-map-editor/
├── index.html              # エントリポイント（src/ui/index.html から配置移動または参照）
├── package.json            # Web用パッケージ情報（Viteなど）
├── README.md               # Web版向けの説明書
├── docs/                   # ドキュメント類
└── src/
    ├── core/               # データモデル・幾何計算・Undo/Redo・操作ロジック（変更なし）
    │   ├── model.js
    │   ├── geometry.js
    │   ├── migration.js
    │   ├── history.js
    │   └── operations.js
    └── renderer/           # 画面描画・UI状態・キャンバス制御（ショートカット調整のみ）
        ├── ui-state.js
        ├── canvas.js
        ├── side-panel.js
        ├── left-panel.js
        ├── tabs.js
        └── renderer.js
```

---

## 5. 動作検証チェックリスト

移植完了時、以下の項目がブラウザ上で正常に動作することを確認してください。

| 検証項目 | 確認内容 | パス/判定 |
| --- | --- | --- |
| **画面描画** | 初期読み込み時、キャンバス・各パネル・ツールバーが崩れず表示されるか | [ ] |
| **データ保存** | 路線や駅を追加・編集した際、`localStorage` に正しく保存されリロード後も保持されるか | [ ] |
| **Undo / Redo** | `Ctrl + Z` / `Ctrl + Y` で正しく履歴が戻る・進むか | [ ] |
| **ファイル出力** | 路線図データ（JSON）の書き出しと読み込みができるか | [ ] |
| **画像出力** | PNG形式での路線図エクスポートが正常に行えるか | [ ] |
| **画像挿入** | 背景・参照画像の読み込み・WebP変換が正しく機能するか | [ ] |
| **レスポンシブ/操作** | マウスホイールでのズーム、ドラッグ移動（パン）、□矩形選択がスムーズに行えるか | [ ] |