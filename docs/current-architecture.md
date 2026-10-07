# Phase 0: 現状調査レポート

対象: 路線図エディタ(Electron / `C:\Dev_support_system\train`)
調査日: 2026-10-05
根拠: `editor-architecture-spec.md` 2章の調査項目1〜9。
**この段階ではソースコードを変更していない**(本ファイルと `docs/` の作成のみ)。
行番号は調査時点(`fe0cb6f` + 未コミットの文書)の `renderer.js` / `main.js` のもの。

> **備考(調査後)**: 2026-10-05、ルート直下の整理を行った。`main.js` → `src/main/main.js`、`index.html` → `src/ui/index.html`、`renderer.js` → `src/ui/renderer.js`、ドキュメント類 → `docs/` へ移動している。**本書は Phase 0 調査時点の記録**なので下の構成は移動前のままにしている。2026-10-05 のうち Stage A〜C(`src/core/` と `src/renderer/` への分割)以後の構成は `docs/code_Desc.md` を参照。

---

## 1. ディレクトリ構成・言語・ビルド・依存・テスト

```
train/
├── main.js                    Electron Main Process(47行)
├── index.html                 DOM + すべての CSS(152行)
├── renderer.js                アプリ本体(1708行・グローバルスクリプト)
├── scripts/make-uninstaller.js  アンインストーラ生成(ビルド補助)
├── build/uninstaller.nsi      NSIS スクリプト
├── package.json / package-lock.json
├── README.md, code_Desc.md, AI-rule.md
├── editor-architecture-spec.md, signaling-server-spec.md  ← 今回の仕様書
└── dist/, up.bat              ビルド成果物・一時起動用(!追跡外)
```

| 項目 | 調査結果 |
|---|---|
| 言語 | **JavaScript のみ**(TypeScript なし)。`package.json` に `"type": "module"` は**無い** |
| モジュール方式 | `renderer.js` は `<script src="renderer.js">` の**単一グローバルスクリプト**(import/export なし)。`main.js` / `scripts/` のみ CommonJS |
| ビルド | `npm.cmd start`(実行)/ `npm.cmd run dist`(electron-builder --win → make-uninstaller) |
| 依存ライブラリ | **`dependencies` は空**。`devDependencies` は `electron` `electron-builder` のみ |
| テスト | **なし**(`test/` `tests/` 無し、`npm test` スクリプト無し、テストフレームワーク無し) |
| `src/` | **なし**(3章の目標構成 `core/ file/ ui/ online/ main/` は存在しない) |

## 2. Electron の構成

| 項目 | 結果 |
|---|---|
| Main / Renderer の分担 | `main.js` は **ウィンドウ生成・Ctrl+W の横取り・単一インスタンスロックのみ**。ロジックはすべて Renderer |
| preload | **preload ファイルは存在しない** |
| IPC | **未使用**(`ipcMain` / `ipcRenderer` / `contextBridge` はどこにも無い) |
| セキュリティ設定 | `contextIsolation: true` / `nodeIntegration: false`(`main.js` L8) |
| CSP | `index.html` L5:`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'` |
| 複数ウィンドウ | Renderer が `window.open('index.html#<mapId>')` で開く。Main は `setWindowOpenHandler` でサイズだけ指定 |
| 別ウィンドウ間の同期 | 同一 `localStorage` + `storage` イベント(`renderer.js` L1688)。Web 版は作業中なら上書きせずバナーで選ばせる(S4) |
| キーボード | Main の `before-input-event` が Ctrl+W を横取りし、Renderer の `window.__closeTab()` を呼ぶ(`main.js` L20-30) |

→ WebRTC / WebSocket は **Renderer の標準 API だけで足りる**(`nodeIntegration` を開ける必要は無い)。仕様6.2の前提と一致。

## 3. 路線図の状態の持ち方

すべて **グローバル変数** 2つに集約されている(`renderer.js` L41・L90)。

```js
let S = { maps: [ Map, … ] }   // 永続データ。localStorage('train-map:v1:maps') に JSON で保存
let ui = { map, line, sel, tool, open, home, zoom, drawing, bulk, bulkRect, bulkMap }  // 画面状態(保存されない)
```

- `Map { id, name, bg, w, h, lines[], roads[], stops[], hubs[], boxes[], images[], show{} }`
- `Line { id, name, color, width, loop, hidden, lock, stations[], crossings[] }`
- `Station { id, name, x, y, hub, shape?, color?, nameX, nameY, nameRot, links{[路線ID]:[駅ID]} }`
- 読み込みは起動時1回(L42)。保存は `save()`(L159)= **変更前のスナップを履歴に積みつつ `setItem`**。
- 表示は `renderCanvas()`(L351)が **SVG の `innerHTML` を丸ごと再生成**。`renderSide()`(L550)・`renderLeft()`(L733)も同じ方式。
- 描画は `ui` / `S` を**直接読んで**描く(描画と状態は密結合)。

## 4. 編集操作の一覧 と 状態更新の場所

すべて「**イベントハンドラ or 編集関数が `S`/`ui` を直接 mutate → `save()` → `renderAll()`**」という同じ形。
`core.dispatch` に相当する**共通の入口は存在しない**が、**共通の出口(`save()` / `renderAll()`)は存在する**。

### 4.1 キャンバス(マウス/キーボード)

| 操作 | 更新箇所 |
|---|---|
| 駅の追加 | `addStation()` L793 ← `cv mousedown`(tool=station)L990-1006 |
| 乗り換え駅の追加 | `addHubStation()` L808 ← mousedown L1007 |
| 踏切の追加 | `addCrossing()` L877 ← mousedown L1008 |
| バス停 / バスターミナル追加 | `addBusStop()` L822 ← mousedown L1009-1010 |
| ラベル枠の追加 | mousedown 内で直接 `m.boxes.push` L1012-1018 |
| 幹線道路の追加 | `addRoadPoint()` L859 / `finishRoad()` L841 / `cancelRoad()` L858 ← mousedown L1011・`dblclick` L1178・`Enter` L1192 |
| **要素の移動(ドラッグ)** | `window mousemove` L1075-1149 が**マウスごとに直接 mutate**(駅・駅名・バス停・バス停名・道路全体・頂点・ラベル枠・画像・踏切)。**確定は `mouseup` L1165-1170 の `save()` 1回** |
| ラベル枠/画像のリサイズ | 同 L1138(`bxr`)・L1130(`imgr`)、新規枠のドラッグ L1139(`bxnew`) |
| 画像の追加/差替え | `importImageFile()` L1253 |
| 削除(1件/□で複数) | `delOne()` L891 / `del()` L915 ← `Delete`/`Backspace` L1191・ツールバー `#del` L1217・`#idel` L1529 |

### 4.2 右パネル(`#side`)

| 種別 | 状態更新の場所 |
|---|---|
| 文字・色・選択・スライダー | `input` ハンドラ L1376-1445:`mname/mbg/lname/lcolor/lwidth/sname/sshape/scolor/snameRot/cname/bsname/bskind/bscolor/bsnameRot/rname/rcolor/rwidth/btext/bfill/iop/izone` を**直接代入** |
| 属する路線のチェック | 同 L1407-1430:`stations` への push/filter、`hubs` からの移動、`links` の付け替え |
| 駅間隔 `#gap`・枠サイズ `#bw/#bh` | `change` L1446-1464(間隔は**それ以降の駅も移動**) |
| 路線の表示/ロック/重ね順 | `click` の `.lyr` L1477-1497 |
| 種類ごとの表示切替 | `click` の `.showel` L1501-1508 |
| 乗り換え駅 ON/OFF | `click` `#shub` L1509 → `setHub()` L783 |
| 環状線 ON/OFF | `click` `#lloop` L1513-1520 |
| 路線の追加/削除 | `click` `#addline` L1557 / `#dline` L1563 |
| 接続する駅の追加/並べ替え/削除 | `click` L1532-1544・`change`(`.linksel`)L1634・ドラッグ L1595-1631 |
| 路線図の名前/背景/削除 | `input` L1378・L1380 / `click` `#dmap` L1585 |
| 色を初期値へ戻す | `#sreset` L1526 / `#bsreset` L1527 |

### 4.3 左パネル・ツールバー・タブ・一覧

| 操作 | 場所 |
|---|---|
| 駅の並べ替え | `moveStation()` L756 ← 左パネル `click` L1649 / `drop` L1674 |
| 選択を削除 / Undo / Redo | ツールバー `click` L1208-1231 |
| JSON 読み込み | `#file` `change` L1232 → `migrate()` + `S` 差し替え |
| JSON / PNG 書き出し | `#exp` L1225 / `exportImage()` L1303(**状態は変えない**) |
| タブ開閉・路線図の新規/削除 | `openMap` L1328・`closeTab` L1333・`newMap` L1342・`deleteMap` L1343 |
| 別ウィンドウからの取り込み | `storage` L1688(**`S` を丸ごと差し替え、履歴もリセット**) |

**洗い出しの結果: 状態を変える箇所は上記の3グループ(キャンバス mousedown/mousemove・編集関数・パネルの input/change/click)に集約されている。** 全数を列挙可能であり、`dispatch` への付け替えは機械的に進められる。

## 5. ID の付け方

```js
const uid = () => Math.random().toString(36).slice(2, 9);   // renderer.js L25
```

- **連番ではなく7文字のランダム文字列**(base36、ほぼ7.6桁のエントロピー)。駅・路線・踏切・道路・画像・路線図すべてこれ。
- 重複はほぼ起きないが **`crypto.randomUUID()` ではない**(衝突時の考慮も無い)。
- → **仕様書4.3の前提「既存は連番の ID」は当てはまらない**(既存からランダム)。改修時の判断材料は「13章の食い違い」参照。

## 6. ファイル形式

- **保存先は `localStorage('train-map:v1:maps')`**、値は `JSON.stringify(S)`。エクスポートは同じ構造の `railmaps.json`(`#exp` L1225)。
  **保存に失敗したら黙らない**: `setSaveFailed(true)` で赤い常駐バナー(「書き出し」付き)+ `beforeunload` を張り、
  次の保存が成功するまで解除しない(S5)。
- 構造: `{ maps: [ { id, name, bg, w, h, lines[], roads[], stops[], hubs[], boxes[], images[], show{} } ] }`
- **`formatVersion` のようなバージョンフィールドは無い。**
- ただし **マイグレーションの仕組みは既に存在する**: `migrate()` L45-88 が旧形式を変換する
  (①欠落配列の補完 ②`show` の正規化 ③`Station.links` の「配列 → 路線ごとのオブジェクト」 ④`type:'road'` の路線を `roads`+`stops` へ)
- 読み込み時の検証は `sanitizeDocument()`(S1)= **拒否ではなく修復**(不正な値は既定へ。入口は「読み込み」「起動時」「storage」の3つ)。

## 7. Undo / Redo

| 項目 | 結果 |
|---|---|
| 有無 | **あり**(ツールバー・Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z・左上のボタン) |
| 方式 | **全体スナップ方式**。`undoStack` / `redoStack` に `{ s: JSON文字列, v: 表示中の路線図・路線 }` を積む。上限50 |
| 記録のタイミング | `save()` L159。「変更前」のスナップを積く。**変化が無ければ積まない** |
| まとめて記録 | 文字入力とスライダーは `deferSave()` L178 で600ms束ね(**連続入力を1履歴に**) |
| 特殊な挙動 | **幹線道路の描画中は Undo が「頂点を1つ戻す」**(`undo()` L197)。Redo は使えない |
| 戻したとき | `applySnap()` L182 が `S` を丸ごと差し替え、開いているタブ/路線を有効な範囲に補正、**選択と□選択を解除** |
| 取り回し | `applySnap` で `S` が差し替わるため、**ハンドラは参照を毎回 `curMap()` 等で取り直す**(既存の暗黙ルール) |

→ Operation 単位の履歴では**無い**。仕様 Phase 2 の条件「Undo/Redo は既存の挙動のまま」を満たすには、**スナップ方式を残す**か、Operation 履歴への移行を Phase 7 以降に回すかの判断が必要(判断ポイント3)。

## 8. 複数の路線図と、アプリを閉じるときの挙動

- **単一ウィンドウ内のタブ**(`#tabs`)+ 「一覧」画面(`renderHome()` L340)。
- `window.open('index.html#<mapId>')` で**別ウィンドウ**。hash があるウィンドウはその路線図だけを開く(L91-92)。
- 開いているタブは `localStorage('train-map:v1:open')` に記憶(`persistOpen()` L1301)。開閉状態は `train-map:v1:acc`。
  キー一覧は `src/renderer/storage.js`(旧 `railmaps` 等からは起動時に `migrateLegacyKeys()` が移行、旧キーは残す)。
- **別ウィンドウ同士は同一 localStorage を使い、`storage` イベントで最新を取り込む**(L1688)。取り込み時に履歴はリセット。
  Web 版では**相手の保存が届いても、こちらに未確定の作業(入力中・ドラッグ中・自動保存の保留)がある間は上書きせず**、
  画面上部のバナーで「相手の版を読み込む / 自分の版を残す」を選ばせる(S4)。
- 終了時: **保存用のフックは存在しない**。`save()` が編集ごとに都度書き込んでいるため、ウィンドウを閉じてもデータは最後の `save()` のまま(失われるものはない)。**閉じる前の確認ダイアログは無い**(未保存=蓄積された履歴のみ)。
- 未コミットの編集は基本発生しない(`save()` が必ず走るため)。

## 9. 描画・イベント・状態更新の混ざり方(分離のしやすさ)

| 観点 | 評価 |
|---|---|
| 状態の定義 | **良い**。`S` / `ui` の2変数に集約され、構造が明瞭 |
| 状態更新 | **ハンドラ内に分散**。ただし種類は3グループに収まる(4章) |
| 描画 | **全書き換え方式**。`renderCanvas` は `S`/`ui` を直接読んで文字列生成(**引数で状態を受け取る形ではない**) |
| イベントと描画の接続 | ハンドラは「mutate → `save()` → `renderAll()`」の定型。**出口は共通** |
| **分離の障害** | ①`renderer.js` が **1ファイルのグローバルスクリプト**(モジュール境界が無い) ②`renderCanvas` が `ui.sel`・`m.show`・`band`・`drag` など**画面の内部状態まで直接参照** ③IDや参照の取り回しがグローバル関数に依存 |

**結論: 状態・操作・描画の「概念的な分離」は既に一定程度あり、`dispatch` の入口を作る作業は現実的。ただしファイル分割(Phase 1)は既存の分割が一切無いため、新規に構成を作る規模。**

---

## 10. 仕様書の前提と実際の食い違い(要報告)

仕様書は「既存コードを確認していない前提の記述」と明記している(0章)。確認できた差分:

| # | 仕様書の前提/記述 | 実際 | 影響 |
|---|---|---|---|
| 1 | 3章 `src/core|file|ui|online|main` のモジュール構成(案) | **`src/` 無し。単一の `renderer.js`(1708行)**。ES modules でも無く `<script src>` | Phase 1 は分割ではなく**新規構成の作成**。モジュール化の方式の決定が必要(判断ポイント1) |
| 2 | 4.3「既存ファイルに**連番の ID** が入っている場合」 | **既存は `Math.random()` の7文字**(`uid()`)。連番ではない | ID 改修の必要性が下がる。既存ファイルへの影響も小さい(判断ポイント2) |
| 3 | 5章「形式のバージョン(例: `formatVersion`)を持たせる」 | バージョン**無し**。ただし **`migrate()` が既に存在**し旧形式を変換している | `formatVersion` の追加は任意。追加しても読み込みは互換可能 |
| 4 | 4.1.3「Operation は確定した編集の単位。ドラッグは mouseup で1回」 | **既存も mouseup の `save()` 1回**(mousemove 中は履歴に積まない) | **仕様と一致**。Operation 化しやすい |
| 5 | 10章「既存のテストの仕組みがあればそれに従う」 | **テストは一切無し** | `node:test` を新規導入(依存追加なしで可) |
| 6 | 7章「メニューに共同編集を設け…」 | **アプリにメニューが無い**(`setMenuBarVisibility(false)`)。操作はツールバーと右パネルのみ | 「共同編集」の置き場が問題(判断ポイント4) |
| 7 | 4.1.1「UI が状態を直接書き換えない」 | すべて直接書き換えている | Phase 2 で全ハンドラを `dispatch` 経由に付け替える必要あり |
| 8 | 3.2「`ui` は `online` を `import()` で動的に読み込む」 | 現状 ESM 未使用 | 判断ポイント1 と同時に決める |
| 9 | (前提)保存はファイル単位 | **永続化は `localStorage` のみ**。JSON 書き出しは手動のバックアップ | 5章「各 Peer が完全な状態を保存」は localStorage 保存で満たされる |
| 10 | 別ウィンドウ同期(`storage`)が既に存在 | あり | オンライン機能と**役割が重複**する可能性。併存で問題ないか要確認 |

## 11. Phase 1 に進む前に決めること(判断ポイント)

仕様書12章の未確定事項のうち、**Phase 1 開始前に必要なもの**。詳細と選択肢は `docs/decisions.md` に記録する。

1. **モジュール化の方式**(未確定事項9/依存の向きに関わる) — ESM(`<script type="module">`)か、グローバルスクリプトの複数分割か。**`file://` 読み込みでの ESM の可否は要検証**(Electron では CORS の制約を受ける可能性がある)。
2. **ID の方針**(未確定事項9) — 既存の `uid()` を残す / `crypto.randomUUID()` へ統一する。
3. **Undo/Redo の方式**(未確定事項6と関連) — Phase 2 でスナップ方式を残すかどうか。
4. **「共同編集」UI の置き場**(7章) — メニューが存在しないため、ツールバー / 右パネル / 新規メニューのどれか。
5. **`formatVersion` の追加可否**(未確定事項13)。
6. **別ウィンドウ同期(`storage`)との役割分担**(10章の差分10)。

---

## 12. 仕様書9.3の確認項目に対する現状(Phase 1 完了条件の下準備)

| 確認項目 | 現状の把握 |
|---|---|
| すべての編集操作が従来どおり動く | 4章の一覧(全35項目程度)をチェックリスト化する必要あり → `docs/regression-checklist.md` |
| 保存して開き直して同じ状態になる | `localStorage` 保存のため、実質常に成立(要手動確認) |
| 既存ファイルが開ける | `migrate()` により旧形式は変換される。**Phase 0 時点のサンプルを1つ保存しておく必要あり** |
| 複数路線図・終了時の挙動 | 8章のとおり(変更禁止) |
| ローカルモードで通信が発生しない | 現状 `renderer.js` に **通信コードは一切無い**(`fetch`/`WebSocket`/`RTCPeerConnection` の使用なし) |
