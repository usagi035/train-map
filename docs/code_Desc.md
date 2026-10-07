# 路線図エディタ コード説明 (code_Desc.md)

対象: railway-map-editor v1.0.0 / 最終更新 2026-10-05
**行番号は記載時点の目安です(コードを編集するとずれます)。関数名・イベント名で検索してください。**

---

## 0. 全体像

Electron 製の2プロセス構成。**データはすべて localStorage に保存**され、バックエンド(サーバ・DB)は無い。

```
npm start
  └─ src/main/main.js (メインプロセス)
       ├─ requestSingleInstanceLock() … 二重起動を拒否
       ├─ createWindow() … BrowserWindow 生成 → src/ui/index.html を読み込む
       └─ before-input-event … Ctrl+W を「路線図タブを閉じる」に割り当て
            └─ src/ui/index.html (画面構造 + CSS)
             └─ <script type="module" src="../renderer/renderer.js"> … 画面側の入口
                  ├─ renderer/ui-state.js … 共通状態・共通操作・renderAll(各画面モジュールはここからのみ import)
                  ├─ renderer/{canvas,side-panel,left-panel,tabs}.js … 描画と各画面の操作
                  ├─ core/{model,geometry,migration,history,operations}.js … 画面に依存しない操作(createCore)
                  ├─ 起動時: localStorage('railmaps') 読込 → migrate() → importDocument → renderAll()
                  ├─ 編集のたびに save() … 履歴に積み + localStorage へ書く
                  └─ renderAll() = renderTabs / renderTools / renderCanvas / renderSide / renderLeft
```

### localStorage に保存するキー

| キー | 中身 | 書き出し関数 |
| --- | --- | --- |
| `railmaps` | 全路線図データ `S`(1つの JSON) | `save()` / `applySnap()` |
| `railopen` | 開いているタブの路線図ID配列 | `persistOpen()` |
| `railacc` | 右パネル各グループの開閉状態 | `saveAcc()` |

> **注意**: 同じ userData を2プロセスで開くとキャッシュ競合(0x5)と上書き競合が起きるため、
> `src/main/main.js` の単一インスタンスロックで防いでいる。

---

## 1. ファイル一覧と役割

| ファイル | 役割 |
| --- | --- |
| `src/main/main.js` | Electron メインプロセス。ウィンドウ生成・Ctrl+W の割り当て・単一インスタンス制御 |
| `src/ui/index.html` | 画面の DOM 構造と**すべての CSS**(外部スタイル無し)。CSP 指定あり |
| `src/core/model.js` | 状態 `S` の読み書き・ID(`newId`)・定数(COLORS/G/SHAPES/…)・各オブジェクト生成・接続の掃除 |
| `src/core/geometry.js` | 距離・区間・環状線の計算(`dist` / `project` / `keepCrossings` など) |
| `src/core/migration.js` | 旧形式のデータを新形式へ変換する `migrate()` |
| `src/core/history.js` | Undo/Redo のスナップ管理(`init` / `push` / `undo` / `redo`) |
| `src/core/operations.js` | 追加・削除・移動などの操作と `createCore()`。**画面側が core に触れる唯一の入口** |
| `src/renderer/ui-state.js` | 画面側の共通状態・共通操作(`ui` / `save` / `renderAll` / □選択 / レイヤー判定 / 道路描画 / 削除)。**他の画面モジュールはここからのみ import する** |
| `src/renderer/canvas.js` | SVG の描画(`renderCanvas`)とズーム・スクロール(`pt` / `applyZoom` / `setZoom` / `centerStation`) |
| `src/renderer/side-panel.js` | 右パネルの描画(`renderSide` / `sec`)と `#side` のイベント |
| `src/renderer/left-panel.js` | 左パネルの描画(`renderLeft` / `stationGlyph`)と駅の並べ替え |
| `src/renderer/tabs.js` | タブと一覧(ホーム)の描画・操作(`renderTabs` / `renderHome` / `openMap` / `closeTab` / `newMap` / `deleteMap`) |
| `src/renderer/renderer.js` | 画面側の入口(約460行)。初期化、マウス・キー・ファイル入力、`storage` 同期、各モジュールの描画関数の登録 |
| `package.json` | npm スクリプト(start / dist / uninstaller)と electron-builder 設定 |
| `scripts/make-uninstaller.js` | `dist/` に「アンインストーラ .exe」を同梱するためのビルド補助 |
| `build/uninstaller.nsi` | NSIS スクリプト(アンインストーラ生成用。上記が使用) |
| `README.md` | ユーザー向けの機能・操作説明 |
| `docs/code_Desc.md` | このファイル(コード構造の説明) |
| `docs/AI-rule.md` | AI への作業ルール(機能追加ごとに commit / 重要な変更は `deb_*` ブランチ) |
| `docs/*.md` | 仕様書(editor-architecture / signaling-server)、Phase 0 調査、判断記録 |
| `scripts/up.bat` | `npm start` の一時起動用(!.gitignore 対象) |
| `dist/`, `build/*.exe` | ビルド成果物(!.gitignore 対象。追跡しない) |

> **ルート直下の追跡対象ファイルは `package.json` / `README.md` / `.gitignore` の3つ**。
> アプリは `src/`、ドキュメントは `docs/`、補助スクリプトは `scripts/` に置く。

---

## 2. データモデル

```
S = { maps: [ Map, … ] }                      // 全路線図

Map {
  id, name, bg, w, h,                         // 背景色 / キャンバスサイズ(400px単位で自動拡張)
  lines:   [ Line, … ],                       // 路線 = レイヤー。配列順 = 描画順(index0=奥)
  roads:   [ Road, … ],                       // 幹線道路(独立要素)
  stops:   [ BusStop, … ],                    // バス停・バスターミナル(独立要素)
  hubs:    [ Station, … ],                    // 路線に属さない乗り換え駅の置き場所
  boxes:   [ LabelBox, … ],                   // ラベル枠
  images:  [ Image, … ],                      // インポート画像
  show:    { road, stop, box, img }           // 種類ごとの表示/非表示(false=非表示)
}

Line  { id, name, color, width, loop, hidden, lock,
        stations: [Station, …], crossings: [Crossing, …] }
Station { id, name, x, y, hub, shape?, color?, nameX, nameY, nameRot,
          links: { [路線ID]: [駅ID, …] } }    // 路線ごとの「接続する駅」。路線外はキー '-'
Crossing { id, seg, t, name }                 // 踏切 = セグメント seg の t(0〜1)位置
Road  { id, name, color, width, pts: [{x,y}, …] }   // 頂点の並びで形を表す
BusStop { id, name, x, y, kind: 'stop'|'terminal', color?, nameX, nameY, nameRot }
LabelBox { id, text, x, y, w, h, fill }
Image { id, src(data URL), x, y, w, h, opacity, z: 'back'|'front' }
```

### ui(画面上の一時状態・保存されない)

| フィールド | 意味 |
| --- | --- |
| `ui.map` / `ui.line` | 表示中の路線図ID / 選択中の路線ID |
| `ui.sel` | 選択中の要素 `{t, id}`。`t` = `st`/`cx`/`stop`/`road`/`bx`/`img` |
| `ui.tool` | 現在のツール(`select`/`station`/`hub`/`crossing`/`busstop`/`terminal`/`road`/`box`) |
| `ui.open` / `ui.home` | 開いているタブID / 一覧画面表示中か |
| `ui.zoom` | 表示倍率(0.25〜3) |
| `ui.drawing` | 幹線道路の描画中 `{pts, hover}` |
| `ui.bulk` / `ui.bulkRect` / `ui.bulkMap` | □(矩形)で複数選択した要素と範囲・対象路線図 |

---

## 3. src/main/main.js(メインプロセス)

| 箇所 | 内容 |
| --- | --- |
| `createWindow()` | 1280×800 の BrowserWindow を生成(メニュー非表示・`contextIsolation:true`)。`src/ui/index.html` を読む。`setWindowOpenHandler` で `window.open()`(別ウィンドウで路線図を開く)を 1200×760 で許可 |
| `app.on('browser-window-created')` | どのウィンドウでも **Ctrl+W** を横取りし `window.__closeTab()` を実行。**false(タブ無し)を返したときだけ**ウィンドウを閉じる |
| `app.requestSingleInstanceLock()` | 2つ目を起動したら既存ウィンドウを前面に出して `app.quit()`。キャッシュ競合(0x5)と localStorage 上書きを防ぐ |
| `app.on('window-all-closed')` | ウィンドウが無くなったら終了(Mac 的挙動はしない) |

---

## 4. src/ui/index.html(画面構造とスタイル)

### DOM 構造

```html
<header>
  <div id="tabs">            … 路線図タブ + 「＋」(追加) + 「一覧」     ← renderTabs()
  <div id="tools">           … ツールバー。data-tool ボタン群、#snap/#autosel、
                                #del #undo #redo、ズーム、#exp #imp #expimg、
                                非表示の #file(JSON) と #imgfile(画像)
<main>
  <aside id="left">          … 左パネル: 選択中の路線の駅リスト(並べ替え) ← renderLeft()
  <div id="stage"><svg id="cv"> … 描画キャンバス(SVG)                    ← renderCanvas()
  <aside id="side">          … 右パネル: 設定(6グループ)                  ← renderSide()
  <div id="home">            … 路線図の一覧画面                          ← renderHome()
<div id="hint">              … ツールごとの操作ヒント(固定表示)
<script type="module" src="../renderer/renderer.js">
```

### CSS のグループ(src/ui/index.html 内 `<style>`)

| 範囲 | 主なクラス | 内容 |
| --- | --- | --- |
| タブ | `.tab` / `.on` / `.x` | 見出しタブと閉じるボタン |
| ツールバー | `#tools button` / `.on` | 押下中は緑 |
| 一覧画面 | `#home li` / `.st` | 路線図リスト |
| パネル共通 | `aside label` / `.row` / `.note` | ラベル・横並び行・補足文 |
| 左右リスト | `#lines` `#roadlist` `#imglist` `.linklist` | 行・選択 `.on`・ハンドル `.lhandle` |
| レイヤー操作 | `#lines .lyr` / `.lyr:disabled` / `#lines li.off` | 👁🔒↑↓ ボタン、非表示行の薄表示 |
| **トグルボタン** | `.tgl` / `[aria-pressed="true"]` | ピル型。ON=緑点灯+白ドット、OFF=グレーのドット。単一ON/OFF項目に使用 |
| 右パネルのグループ | `.sec` `.sech` `.sect` `.secn` `.seci` `.secb` `.subh` | 開閉セクション(見出し=ボタン、`▾`回転、バッジ `.secn`) |
| 接続リスト | `.linkgroup` / `.linklist` / `.badge` | 路線ごとの「接続する駅」 |
| ヒント | `#hint` | 左下に固定 |

CSP: `default-src 'self'`(script/style の inline と `data:` 画像のみ許可)。

---

## 5. 画面側の構成(src/renderer/)

`src/renderer/renderer.js` が画面側の入口で、ファイル末尾の `renderAll()` が起動時の入口。
import は **ui-state → 各画面モジュール** の一方向だけにし(相互 import で循環しない)、
描画関数は `renderer.js` が `setRender({tabs, home, canvas, side, left})` で**最初の `renderAll()` より前に**登録する。
1つだけ描き直すときは `renderPart(name)` を使う。

| モジュール | 役割 |
| --- | --- |
| `ui-state.js` | 画面側の共通状態と共通操作(`core` の生成、`ui`、`save`、`renderAll`、□選択、レイヤー判定、道路描画、削除) |
| `canvas.js` | SVG 描画とズーム・スクロール |
| `side-panel.js` | 右パネルの描画と `#side` のイベント |
| `left-panel.js` | 左パネルの描画と駅の並べ替え |
| `tabs.js` | タブ・一覧(ホーム)の描画と操作 |
| `renderer.js` | 初期化・マウス/キー/ファイル入力・`storage` 同期・描画関数の登録 |

以下の5.1〜5.14 は**関数単位の説明**(行番号は分割前)。各節の置き場所は次のとおり。

| 節 | 置き場所 |
| --- | --- |
| 5.1 定数・ユーティリティ | `core/model.js`。`HINTS` / `esc` は `ui-state.js` |
| 5.2 初期化と旧形式の移行 | `ui-state.js`(`migrate` は `core/migration.js`) |
| 5.3 アクセサ | `core/model.js` + `ui-state.js`(`curMap` / `curLine` / `findStation` / `linesOf`) |
| 5.4 履歴と保存 | `save` / `deferSave` / `viewNow` は `ui-state.js`、`applySnap` / `undo` / `redo` は `renderer.js`、`snapStr` は `core/model.js` |
| 5.5 幾何 | `core/geometry.js` |
| 5.6 □選択・5.7 レイヤー判定 | `ui-state.js` |
| 5.8 描画 | `tabs.js` / `ui-state.js`(`renderTools`・`renderAll`) / `canvas.js` / `side-panel.js` / `left-panel.js` |
| 5.9 編集操作 | 本体は `core/operations.js`。`del` と道路描画は `ui-state.js`、追加系は `renderer.js`、`setHub` は `side-panel.js` |
| 5.10 座標・ズーム | `snapPt` / `afterAdd` は `ui-state.js`、`pt` / `applyZoom` / `setZoom` は `canvas.js` |
| 5.11 イベント | 全体(マウス・キー・ツールバー・ファイル)は `renderer.js`、`#side` / `#left` / `#tabs`・`#home` は各モジュール |
| 5.12 画像のインポートと書き出し | `renderer.js` |
| 5.13 路線図タブの管理 | `tabs.js` |
| 5.14 別ウィンドウとの同期 | `renderer.js` |

### 5.1 定数・ユーティリティ(L1〜40)

| 名前 | 動作 |
| --- | --- |
| `COLORS` | 路線に順番に割り当てる既定色6色 |
| `G=20, W=2400, H=1600` | 1マスのpx / 初期キャンバスサイズ |
| `mw(m), mh(m)` | 路線図の幅・高さ(未設定なら `W`/`H`) |
| `ensureRoom(m, x, y)` | 必要な分だけキャンバスを **400px 単位で右・下に自動拡張**(draw.io方式) |
| `SHAPES`, `STOP_KINDS`, `STOP_COLOR` | 駅の形・バス停の種別のラベル、バス停既定色 |
| `HINTS` | ツールごとのヒント文(select/station/hub/crossing/busstop/terminal/road/box) |
| `newId()` | ID生成(`crypto.randomUUID`。旧 `uid()` から変更) |
| `clamp(v,a,b)`, `esc(s)` | 数値クランプ / HTMLエスケープ |
| `mkLine/mkRoad/mkBusStop/mkMap/mkStation/mkImage` | 各オブジェクトの生成(既定値入り) |
| `lw(l)` | 路線の太さ(`width \|\| 8`) |
| `isDark(hex)` | 背景色が暗いか(文字色・グリッド色の選択に使用) |

### 5.2 初期化と旧形式の移行(L41〜97)

| 名前 | 動作 |
| --- | --- |
| `S` 読み込み | `localStorage('railmaps')` を parse。壊れていたら空の路線図1枚を用意 |
| `migrate(data)` | **旧形式の変換**。①`roads/stops/images/show/hubs` の欠落配列を補う ②`show` の4キーを boolean に正規化 ③駅の `links` が**配列(旧)**なら所属路線ごとの**オブジェクト**へ変換し、存在しない駅IDを除去 ④`type:'road'` の路線(旧道路表現)を `roads` + `stops` へ移す |
| `ui` 初期化 | 選択中路線図・路線・ツール等を初期化 |
| `hm` | `location.hash` がある = **別ウィンドウで開いた**路線図。その1つだけを開く |
| タブ復元 | hash が無ければ `railopen` から開いていたタブを復元。無ければ一覧画面 |

### 5.3 アクセサ(路線図・路線・駅・接続)(L99〜143)

| 関数 | 動作 |
| --- | --- |
| `curMap()` | 表示中の路線図(無いなら先頭) |
| `curLine()` | 選択中の路線(無いなら先頭) |
| `findStation(id)` | `m.hubs` と全路線の `stations` から駅を探す(乗り換え駅は両方に入り得る) |
| `linesOf(id)` | その駅が属する路線(0〜複数。路線外の乗り換え駅は0本) |
| `allStations(m)` | 全駅を**IDで重複排除**して返す(複数路線に共有される同一駅は1つ) |
| `OFF_LINK` | `'-'`…路線に属さないときの接続リストのキー |
| `linksIn(s, lid)` | 駅 `s` の路線 `lid` 用「接続する駅」配列(無ければ空) |
| `linkGroups(m, s)` | 右パネルに並べる接続グループ(属する路線ごと + 必要なら「路線外」) |
| `flattenLinks(s)` | 路線外へ出るとき、路線ごとの接続を `'-'` にまとめる |
| `pruneLinks()` | 存在しなくなった駅を指す接続IDを全駅から掃除 |

### 5.4 履歴(元に戻す)と保存(L145〜214)

| 関数 | 動作 |
| --- | --- |
| `snapStr()` | `JSON.stringify(S)`(失敗時は空文字) |
| `viewNow()` / `syncView()` | 表示中の路線図・路線を記録(undo で開き直すため) |
| `updateUndoButtons()` | ツールバーの ↶/↷ を有効/無効化 |
| **`save()`** | ①変化が無ければ何もしない ②**変更前のスナップを `undoStack` に積む**(上限50、`redoStack` はクリア) ③`localStorage('railmaps')` へ書く。**失敗時は警告＋1セッション1回だけ alert**(容量超過対策) ④Undoボタン更新 |
| `deferSave()` | 600ms 後に `save()`。文字入力・スライダーの連続操作を**1履歴にまとめる** |
| `applySnap(e)` | スナップ文字列 `S` に差し替え、localStorage へ書く、開いているタブ/路線を有効な範囲に補正、選択と□選択を解除して `renderAll()` |
| `undo()` / `redo()` | **道路の描画中は履歴ではなく「頂点を1つ戻す」**(0個なら中止)。それ以外はスナップを差し替える |
| `quotaWarned` | 容量警告を1回だけ出すためのフラグ |

### 5.5 幾何(L216〜251)

| 関数 | 動作 |
| --- | --- |
| `dist(a,b)` | 2点間距離 |
| `isLoop(l)` | `l.loop` かつ駅2つ以上 = 環状線 |
| `segCount(l)` | 区間数(環状線は駅数と同じ、開線は駅数-1) |
| `segA(l,i)` / `segB(l,i)` | 区間 `i` の始点/終点(環状線は最後→最初を巡回) |
| `segPt(l, seg, t)` | 区間上の位置(踏切は `seg`+`t` で保持している) |
| `project(l, p)` | 路線全体のどこに最も近いか `{seg, t, d, x, y}`(駅の追加位置判定に使用) |
| `keepCrossings(l, fn, ps)` | **踏切の位置を保つためのラッパ**。`fn()` の前後で踏切を新しい経路上に再射影(`ps` を渡すとそれを基準にする = 環状線ON/OFF時など区間数が変わるとき) |

### 5.6 □(矩形)選択(L253〜260)

| 関数 | 動作 |
| --- | --- |
| `getBulk()` | 矩形選択の結果。**別路線図のときや空なら無効扱いで空配列** |
| `clearBulk()` | 解除 |
| `rectOf(a,z)` / `inBox(p,b,pad)` | 矩形の正規化 / 中心点(+余白)が矩形内か |

### 5.7 レイヤー(表示/非表示・重ね順・編集ロック)(L261〜331)

| 関数 | 動作 |
| --- | --- |
| `showEl(m, k)` | 種類(road/stop/box/img)が表示中か。`m.show` が無ければ全て表示 |
| `isStationLocked(s)` | 駅が属する**路線のどれかがロック中**ならロック |
| `hitLocked(el)` | クリック対象(SVG要素)がロック中の駅/踏切なら true(選択・操作を拒否) |
| `selVisible(sel)` | 表示設定を変えた後も選択中の要素が見えているか(駅は「路線外なら常に表示」) |
| `lineEditBlocked()` | 現在の路線がロック/非表示なら **理由付き alert** を出して true |
| `pickInBox(m, b)` | 矩形に重なる要素を集める。**非表示・ロック中の路線、非表示の種類は除外**、重複IDは排除 |

### 5.8 描画

| 関数 | 動作 |
| --- | --- |
| `renderTabs()` | タブ行を生成(選択中 `.on`、✕、`＋`、`一覧`) |
| `renderHome()` | 路線図一覧(開く/削除/新しい路線図) |
| `renderTools()` | ツールボタンの `.on` 切替、ヒント文、カーソル、Undo/Redo 有効化 |
| **`renderCanvas()`** | SVG を文字列生成で**全書き換え**。順序: 背景+グリッド → 画像(背面/back) → ラベル枠 → 幹線道路 → 描画中プレビュー → 踏切の道路バー → **線路+駅間隔の数字** → 踏切記号 → **接続線(1本化)** → **駅** → バス停 → 画像(前面/front) → □選択の枠とハイライト。非表示路線・非表示種類は描かない。選択中は破線の枠とリサイズ用 ■ を足す |
| └ 内部 `drawImages(zone)` | 画像要素の描画。**back かつ非選択のみ `pointer-events:none`**(下の要素を選べるように) |
| └ 内部 `drawStation(s, l)` | 駅の形(丸/二重丸/四角/ひし形)・ハブの点線・選択枠・駅名(`nameX/nameY/nameRot` 回転) |
| └ 内部 `conn(s)` | 駅の `links` から接続線を描く。`drawnConn` で `from>to` の重複を除き**常に1本だけ**。色と太さは接続先の駅の路線(路線外はグレー) |
| └ 内部 `xf(l,c)` / `dims(l)` | 踏切の位置と回転(線の接線方向)/ 踏切バーの寸法 |
| `sec(id, title, body, badge)` | 右パネルの開閉セクションHTML(`aria-expanded` 付き見出し + バッジ + `▾`) |
| `renderSide()` | 右パネルを生成。**6グループ**: ①`sel` 選択中の要素(駅/乗り換え駅/バス停/道路/ラベル枠/画像/踏切/□選択) ②`lines` 路線(レイヤー)+「その他の表示」トグル ③`line` 選択中の路線(名前・色・太さ・環状線トグル) ④`roads` ⑤`images` ⑥`map` 路線図の設定。**選択が変わったら `sel` を自動で開き先頭へスクロール、それ以外は開いた位置を維持**(`keepScroll`) |
| `stationGlyph(s, l)` | 左パネル用の小さい駅シンボル(SVG) |
| `renderLeft()` | 左パネル: 選択中の路線の駅を**経路順**に並べる(並べ替えハンドル・↑↓・「乗」バッジ・非表示/ロック表示) |
| `moveStation(l, from, to)` | 駅の並べ替え。`keepCrossings` で踏切位置を保持 → `save()`+`renderAll()` |
| `centerStation(s)` | ステージをその駅の中央へスクロール |
| **`renderAll()`** | 一覧画面かエディタかで表示を切り替え、`renderTabs` →(エディタなら)`renderTools/renderCanvas/renderSide/renderLeft` |

### 5.9 編集操作(L781〜927)

| 関数 | 動作 |
| --- | --- |
| `setHub(st, on)` | 乗り換え駅の ON/OFF。**OFF にすると必ず1つの路線に乗せ直し**、他路線と `m.hubs` からは外す |
| `addStation(p)` | ロック/非表示なら **alert で拒否**。線に近ければ(14px以内)間に挿入、それ以外は末尾へ追加。グリッドスナップ、`ensureRoom`、選択、`afterAdd()`(「追加後に選択へ戻る」) |
| `addHubStation(p)` | **どの路線にも属さない**乗り換え駅を `m.hubs` に追加(名前は「乗換駅N」)、ツールは select へ |
| `addBusStop(p, kind)` | バス停/バスターミナル追加。**非表示でも `show.stop = true` に復帰** |
| `startRoadDrawing()` | 道路描画開始。`show.road = true` に復帰 |
| `addRoadPoint(p)` | 頂点追加。**最初の頂点から14px以内なら自動で閉じて確定** |
| `finishRoad()` | 頂点2つ以上で確定。既存色と被らない色を自動選択、道路を追加して選択 |
| `cancelRoad()` | 描画中止(selectへ戻る) |
| `updateRoadHint()` | 「頂点をN個配置 — Enterで確定…」とヒントを更新 |
| `addCrossing(p)` | 路線に18px以内にしか置けない。**ロック/非表示の路線は alert で拒否**。`snapCx` でグリッド上に合わせ、対象路線を選択状態にする |
| `delOne(sel)` | 1要素削除。**ロック中の駅・踏切は削除しない**。乗り換え駅は全路線+`hubs` から削除。削除後 `pruneLinks()` |
| `del()` | □選択があれば**まとめて削除**、無ければ選択中の1件を削除 |

### 5.10 座標・ズーム(L929〜956)

| 関数/定数 | 動作 |
| --- | --- |
| `pt(e)` | クライアント座標 → SVG座標(zoom を割る) |
| `snapPt(p)` | 「グリッドに合わせる」ON なら20px単位に丸める |
| `afterAdd()` | 「追加後に選択へ戻る」ON ならツールを select に戻す |
| `snapCx(l, r)` | 踏切の位置をグリッド点へ合わせて再計算(`seg`/`t` を返す) |
| `applyZoom()` | SVG の `width/height/viewBox` とズームラベル(%)を更新 |
| `setZoom(z, cx, cy)` | 0.25〜3に丸め、**指定した画面位置を固定したまま倍率変更** |

### 5.11 イベントハンドラ一覧

#### キャンバス・マウス

| 箇所 | 動作 |
| --- | --- |
| `stage wheel` | **Ctrl+マウスホイールでズーム**(カーソル位置を基準) |
| `stage mousedown` + `window mousemove/mouseup` | **中ボタン or Space+ドラッグでパン** |
| **`cv mousedown`** | ツールごとの分岐: `station`(既存駅をクリックしたら追加せず選択+selectへ切替 / 空白へ追加)・`hub`・`crossing`・`busstop`・`terminal`・`road`(頂点追加)・`box`(ドラッグで四角)。select モードは要素ごとに `ui.sel` と `drag` を設定(駅/駅名/バス停/バス停名/道路/頂点/ラベル枠/画像/リサイズ■/踏切)。**空白か線のドラッグは □矩形選択開始**。`hitLocked` なら何もしない |
| `window mousemove`(band/drag) | □選択の追従、または各要素のドラッグ移動(スナップ・`ensureRoom`・クランプ・**ハブ駅は全路線の同じ駅を同時に動かす**)。最後に `renderCanvas()+renderSide()` |
| `window mouseup` | □確定 → `finishBand()` / ドラッグ終了 → `save()` |
| `finishBand()` | 動かさなかったクリックなら路線選択のみ。動かしていれば `pickInBox` で複数選択(`ui.bulk` に設定) |
| `window mousemove`(drawing) | 道路描画中の予告線(`hover`) |
| `cv dblclick` | 道路のダブルクリックで確定 |
| `window keydown` | **Ctrl+W**=タブ閉じる / **Ctrl+Z・Ctrl+Y(Ctrl+Shift+Z)**=undo/redo(テキスト欄中は除く) / **Delete・Backspace**=削除 / **Enter**=道路確定 / **Esc**=道路中止→□解除→selectに戻る / **Space**=押下中はパンモード |
| `window keyup` | Space 解除 |

#### ツールバー・ファイル

| 箇所 | 動作 |
| --- | --- |
| `#tools click` | ツール切替(道路描画中は先に確定)、`#del` 削除、`#undo`/`#redo`、ズーム(#zin/#zout/#zreset)、`#imp`→JSON読込ダイアログ、`#addimg`→画像ダイアログ、`#exp`→**JSON書き出し**、`#expimg`→PNG書き出し。※ ボタンは `blur()` して Enter/Space の誤爆を防止 |
| `#file change` | JSON を parse → `maps`/`lines` の形を検証 → `migrate()` → `ui` を初期化 → `save()`。ダメなら alert |
| `#imgfile change` | `importImageFile(file, imgReplaceId)` を呼んで即クリア |

#### 右パネル `#side`

| 箇所 | 動作 |
| --- | --- |
| `input` イベント | 全入力欄の分岐: `mname/lname/lcolor/lwidth`(路線)、`mbg`(背景)、`sname/sshape/scolor/snameRot`(駅)、`cname`(踏切)、`bsname/bskind/bscolor/bsnameRot`(バス停)、`rname/rcolor/rwidth`(道路)、`btext/bfill`(ラベル枠)、`iop/izone`(画像不透明度・重ね順)。**`.shubline`(属する路線のチェック)**: チェックで路線に組み込み `hubs` から外す(初めて乗る路線なら「路線外」の接続を移す)、外すとどの路線にも無くなったら **`m.hubs` へ戻して消さない**+`flattenLinks()`。末尾: 文字入力とスライダーは `deferSave()`、他は `save()` |
| `change` イベント | `#gap`(前の駅との間隔)…**これ以降の駅も一緒に動かす** / `#bw` `#bh`(ラベル枠のサイズ)。それ以外は `renderSide()` で再描画 |
| `click` イベント | 見出し `[data-sech]` で開閉(`railacc` に記憶) → `.lyr`(**👁表示/非表示・🔒ロック・↑↓重ね順**。表示設定が変わったら□選択解除・見えない選択解除) → 路線行(`ui.line` 切替) → 道路行(選択) → **`.showel` トグル(種類ごとの表示・データから反転)** → **`#shub` トグル(乗り換え駅ON/OFF→`setHub`)** → **`#lloop` トグル(環状線ON/OFF・踏切を再射影)** → 画像行(選択) → `sreset`/`bsreset`(色を初期値へ) → `droad`/`idel`/`ichg` → 接続リストの `lup`/`ldown`/`ldel`(↑↓・削除) → 接続行のクリック(**その駅を選択してパネル切替**) → `newwin`(別ウィンドウ) → `addline`(路線追加) → `addroadp`(道路描画へ) → `dline`(路線削除。**消える路線にしか無かった乗り換え駅は `hubs` に残し、路線ごとの接続は掃除**) → `dmap`(路線図削除) |
| `dragstart/over/drop/dragend` | 接続リストのドラッグ並べ替え(**同じリストの中だけ**可) |
| `change`(`.linksel`) | 接続先セレクトで駅を選ぶと**その場で追加**(重複は無視)。追加ボタンは無い |

#### 左パネル `#left`

| 箇所 | 動作 |
| --- | --- |
| `click` | `sup`/`sdown` で並べ替え(`moveStation`)、行クリックで駅を選択して `centerStation` |
| `dragstart/over/drop/dragend` | 駅のドラッグ並べ替え(経路順の変更) |

#### タブ・一覧

| 箇所 | 動作 |
| --- | --- |
| `#tabs click` | タブ切替 / ✕ で `closeTab` / `#addmap` で `newMap` / `#listbtn` で一覧へ |
| `#home click` | `openMap` / `deleteMap`(確認ダイアログ) / `newMap` |

### 5.12 画像のインポートと書き出し(L1246〜1327)

| 関数 | 動作 |
| --- | --- |
| `checkQuota()` | スナップが4.5MBを超えたら「上限に近づいている」alert |
| `importImageFile(file, replaceId)` | 画像判定 → FileReader → Image。**最長辺1600px に縮小**(または400KB超)して canvas から `image/webp` 0.85(WebP非対応環境はPNG)に再エンコード → `replaceId` あれば差し替え(位置・大きさはそのまま)、無ければ**表示中画面の中央に 最長辺900px で配置**。`show.img = true` に復帰、`ensureRoom`、`checkQuota()` |
| `persistOpen()` | `railopen` へ開いているタブを保存(hash 付き=別ウィンドウでは保存しない) |
| `exportImage()` | SVG を serialize → base64 → Image → canvas に背景色ごと描画 → **PNG をダウンロード** |

### 5.13 路線図タブの管理(L1328〜1372)

| 関数 | 動作 |
| --- | --- |
| `openMap(id)` | タブに追加して表示(選択路線は先頭の路線へ) |
| `closeTab(id)` | タブを閉じる。閉じたのが表示中なら隣へ移動、無ければ一覧へ |
| `newMap()` | 「路線図 N+1」を作成して開く |
| `deleteMap(id)` | 路線図を削除(**先に `save()` してから表示を切り替える** = 履歴で復元可能)。全部消えたら空の路線図を1枚用意 |
| `window.__closeTab()` | **`src/main/main.js` の Ctrl+W から呼ばれる**。true=タブを閉じた / false=もう無いのでウィンドウを閉めてよい |

### 5.14 ほかのウィンドウとの同期(L1687〜1706)

| 箇所 | 動作 |
| --- | --- |
| `window 'storage'` | 別ウィンドウが `railmaps` を書き換えたら取り込む(**ドラッグ中は無視**)。取り込み時に**履歴はリセット**、開いているタブ/路線を有効な範囲に補正。`renderTabs`+`renderCanvas`、**入力欄にフォーカスがある間は `renderSide()` しない**(打ちかけの入力を消さないため) |

---

## 6. scripts/make-uninstaller.js

`npm run dist` の後に呼ばれ、NSIS のアンインストーラを `dist/` に同梱する。

| 関数 | 動作 |
| --- | --- |
| `findMakensis()` | electron-builder のキャッシュ(`%LOCALAPPDATA%` 等の `nsis*` フォルダ)から `makensis.exe` を探す |
| `main()` | ①`build/uninstaller.nsi` を makensis でビルド → ②生成されたインストーラを `/S`(サイレント)で1回実行し、**WriteUninstaller が書いたアンインストーラを `%TEMP%` から回収** → ③`dist/Uninstall RailwayMapEditor.exe` へコピー → ④一時フォルダを掃除。makensis が無い場合は**警告を出してスキップ**(エラーにしない) |

---

## 7. ビルド・実行方法

| コマンド | 内容 |
| --- | --- |
| `npm.cmd start` | 開発実行(`electron .`)※ `npm` 自体はポリシーで弾かれるため `npm.cmd` を使う |
| `npm.cmd run dist` | electron-builder(Win: nsis + portable)→ `scripts/make-uninstaller.js` |
| `npm.cmd run uninstaller` | アンインストーラ生成のみ |

出力は `dist/`(追跡外)。同梱ファイルは `src/` 以下すべて(`package.json` の `files`)。
インストール先は `%LOCALAPPDATA%\Programs\railway-map-editor`、データは `%APPDATA%\railway-map-editor`(localStorage)。

---

## 8. 補足・実装上の約束

1. **Undo/Redo は全体スナップ方式** — `applySnap` で `S` オブジェクトが差し替わるため、
   参照を保持している変数は古くなる。ハンドラ内では毎回 `curMap()`/`findStation()` を取り直す。
2. **`save()` は「変更前の状態」を履歴に積む** — 呼び出し側は変更後に呼ぶだけで Undo になる。
3. **描画は全書き換え** — `renderCanvas()` は SVG の `innerHTML` を作り直す。選択中などの
   状態はすべて `data-t` / `data-id` 属性と `ui.sel` から復元する。
4. **ロック/非表示はキャンバス操作を拒否し、パネルからは編集可能** — 誤操作防止。
   追加時に拒否した場合は必ず理由付き `alert` を出す。
5. **非表示の種類に要素を追加したら自動で表示に戻す**(`show.* = true`)。
6. **踏切は「区間+比率」で保持** — 駅を動かしても `keepCrossings()` で同じ場所に追随する。
7. **容量上限** — 画像は縮小+WebP化して `localStorage` に載せる。失敗時は警告を出す。
8. **接続線は常に1本** — 同じ2駅が複数のリストに載っていても `drawnConn` で重複を消す。
