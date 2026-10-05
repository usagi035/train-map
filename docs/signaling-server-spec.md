# WebRTC シグナリングサーバー 仕様書(v1)

路線図エディター オンライン共同編集用。OpenCode による実装向け。

## 0. この文書について

- 対象は**シグナリングサーバーだけ**。路線図エディター(Electron)側の実装は対象外。
- 関連文書: 「路線図エディター オンライン共同編集 要求仕様書」(Hostなし / 最大4人 / WebRTC Full Mesh)。本書はそのうちサーバー側を具体化したもの。
- 表記: 「必須」= 実装しなければならない / 「推奨」= 特に理由がなければ実装する / 「任意」= 実装してもよい。
- 本書の内容と要求仕様書が食い違う場合は本書を優先する。食い違いは「24. 元の仕様からの変更点」にまとめてある。

---

## 1. 概要と前提

### 1.1 目的

最大4人が WebRTC Full Mesh で路線図を共同編集するとき、**接続相手の発見と WebRTC 接続の確立**(SDP Offer / Answer と ICE Candidate の交換)だけを仲介する。

### 1.2 運用前提(設計に直接影響する)

- 公式の運用サーバーは**存在しない**。アプリは OSS で、オンライン共同編集を使いたい人が**各自でこのサーバーを立てる**。
- 作者本人は、自宅の Ubuntu Server で `node` を**必要なときだけ起動し、用が済んだら止める**。常時稼働はしない。
- メモリ・CPU に余裕がない環境を想定する。**軽量であることは要件**。
- 外部公開は Cloudflare Tunnel(`cloudflared`)経由を主に想定する。サーバーはローカルで待ち受け、ポート開放は不要。
- サーバーの URL は毎回変わりうる(Quick Tunnel の場合)。クライアントは招待情報にサーバー URL を含めて共有する(「18. クライアントとの契約」参照)。

### 1.3 サーバーが担当すること

- ルームの作成・参加・退出の管理(すべてメモリ上)
- ルームパスワードによる参加認証
- Peer ID と Peer Order の発行
- 参加者の通知(`peer-joined` / `peer-left`)
- SDP Offer / Answer と ICE Candidate の**無加工での転送**

### 1.4 サーバーが担当しないこと

路線図データ、Operation、Snapshot、編集履歴の保存・中継・参照はいっさい行わない。これらは WebRTC DataChannel で Peer 間が直接やり取りする。サーバーはそれらを**受け取れてはならない**(「8.4 signal」の検証と、メッセージサイズ上限で担保する)。

---

## 2. 設計方針

1. **Host を作らない。** 全 Peer は対等。最初に入った人(Creator)にも特別な権限はない。Creator が抜けてもルームは続く。
2. **ルームの生存期間 = 参加者がいる間。** 最初の Peer の接続と同時に生まれ、最後の Peer が抜けたら消える。永続化しない。
3. **ソケットを維持する。** 参加中はシグナリングの WebSocket を切らない。切断は退出として扱う。
4. **Peer ID・Peer Order・パスワードは必ずサーバーが生成する。** クライアントの指定は受け付けない。
5. **依存を最小にする。** 外部依存は `ws` のみ。ほかは Node.js 標準モジュールで実装する。
6. **サーバー内の状態は小さく保つ。** 上限(ルーム数・接続数・メッセージサイズ)を設定可能にして、超えたら拒否する。

---

## 3. 技術要件

- Node.js 22 LTS 以上。
- 言語は JavaScript(ESM, `"type": "module"`)。TypeScript は使わない。
- 依存: `ws` のみ(`dependencies`)。`devDependencies` は原則なし。テストは `node:test` を使う。
- WebSocket は `ws` を `noServer: true` で使い、HTTP サーバーの `upgrade` イベントで接続を受ける。
- `perMessageDeflate` は**無効**にする(CPU 節約)。
- `maxPayload` は `MAX_MESSAGE_SIZE` に合わせる。
- 乱数は `node:crypto`(`randomBytes` / `randomInt`)のみ。`Math.random()` は使わない。
- サーバー自身は WebRTC の PeerConnection を作らない。STUN / TURN の役割も持たない。

---

## 4. 用語とID

| 用語 | 内容 |
|---|---|
| Room | 共同編集の一時的な空間。メモリ上にのみ存在する |
| Peer | ルームに接続している1つの WebSocket 接続(= 1人の参加者) |
| roomId | ルームの識別子。`randomBytes(16)` の base64url(22文字)。形式: `^[A-Za-z0-9_-]{22}$` |
| password | ルームの参加用パスワード。後述の「6. 認証」 |
| peerId | Peer の識別子。`randomBytes(12)` の base64url(16文字)。形式: `^[A-Za-z0-9_-]{16}$` |
| peerOrder | ルーム内での参加順。0 始まりの整数 |

### 4.1 peerOrder の規則(重要)

- ルーム内で**単調増加**の連番。最初の Peer(Creator)が `0`、次が `1`、…。
- **欠番は再利用しない。** Peer が抜けても番号は詰めない。
- したがって、退出と再参加を繰り返すと `peerOrder` は `4` 以上になりうる(同時参加は最大4人だが、番号は4未満とは限らない)。
- 退出した Peer が再参加した場合は**新しい Peer**として扱い、新しい `peerId` と新しい `peerOrder` を発行する。以前の ID は復元しない。
- クライアントは `peerOrder` を「小さいほうが先に参加した」という大小比較にだけ使う(競合時の優先順位など)。

---

## 5. ルームのライフサイクル

### 5.1 作成

- クライアントは WebSocket 接続後、`create-room` を送る(「8.1」)。
- サーバーは `roomId` と `password` を生成してルームを作り、その接続を**最初の Peer(`peerOrder = 0`)として即座に参加**させる。
- 応答は `room-created`(`roomId`、`password`、自分の `peerId`、`peerOrder`)。
- 作成前に他人が参加できる状態は存在しない(作成と Creator の参加が不可分)。

### 5.2 参加

- クライアントは `roomId` と `password` を添えて `join` を送る。
- 認証に成功し、かつ満員でなければ、新しい `peerId` と `peerOrder` を発行して参加させる。
- 応答は `joined`。**既に参加している Peer の一覧**(`peerId` と `peerOrder`)を含む。
- 既存の Peer 全員へ `peer-joined` を通知する。

### 5.3 退出・切断

次のどれでも Peer は退出扱いになり、ルームから削除される。

- `leave` メッセージ
- WebSocket の close / error
- heartbeat タイムアウト
- 違反が上限を超えたことによるサーバー側の切断

残りの Peer へ `peer-left` を通知する。**Creator の退出も他の Peer と同じ扱い**で、ルームは終了しない。

### 5.4 ルームの削除

- ルームに Peer が 0 人になった時点で、即座に削除する。
- 「ホストが来ない」ルームは存在しない(作成と同時に Creator が参加するため)。`ROOM_TIMEOUT` のような設定は設けない。

### 5.5 最大人数

- `MAX_PEERS_PER_ROOM`(既定 4)を超えて参加させない。満員なら `ROOM_FULL`。
- 判定は**認証に成功した後**に行う(満員かどうかでルームの存在が漏れないようにする)。

---

## 6. 認証(パスワード)

- 参加には `roomId` と `password` の**両方**が必要。`roomId` だけでは参加できない。
- パスワードはサーバーが生成する。16文字、文字集合は紛らわしい文字を除いた 32 文字 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`、`crypto.randomInt` で1文字ずつ選ぶ(約 80 ビット)。
- 受信したパスワードは、ハイフン・空白を除去して大文字にそろえてから比較する(利用者が手入力・コピーしやすいように)。
- 比較は `crypto.timingSafeEqual`(長さが違う場合は先に不一致とする)。
- パスワードはメモリ上にのみ保持し、**ログに出力しない**。
- ルームが存在しない場合と、パスワードが違う場合は、**同じエラー `AUTH_FAILED`** を返す(区別しない)。
- 認証失敗は IP 単位で数える(「11.2」)。上限を超えた IP の `join` は `RATE_LIMITED` で拒否する。

---

## 7. 接続フロー(Full Mesh)

```text
Creator(A)              Server               新規参加者(B)         新規参加者(C)
   │ create-room          │                        │                    │
   ├─────────────────────>│                        │                    │
   │ room-created         │                        │                    │
   │<─────────────────────┤                        │                    │
   │                      │       join             │                    │
   │                      │<───────────────────────┤                    │
   │ peer-joined(B)       │ joined(peers=[A])      │                    │
   │<─────────────────────┤───────────────────────>│                    │
   │                      │                        │ signal(offer→A)    │
   │ signal(offer from B) │<───────────────────────┤                    │
   │<─────────────────────┤                        │                    │
   │ signal(answer→B)     │                        │                    │
   ├─────────────────────>│ signal(answer from A)  │                    │
   │                      ├───────────────────────>│                    │
   │<════════ ICE candidates(signal)の交換 ════════>│                    │
   │<═════════════ WebRTC DataChannel(P2P)════════>│                    │
   │                      │                        │         join       │
   │                      │<────────────────────────────────────────────┤
   │ peer-joined(C)       │ peer-joined(C)         │ joined(peers=[A,B])│
   │<─────────────────────┤───────────────────────>│<───────────────────┤
   │                      │            Cが A と B にそれぞれ Offer を送る │
```

- **Offer を送るのは新しく入った Peer。** `joined.peers` に含まれる全員に対して、新規参加者が Offer を送る。
- 既存の Peer は `peer-joined` を受け取ったら、その Peer からの Offer を待つ(Answer 側に回る)。これで Offer の出し合い(glare)を避ける。
- サーバーは Offer / Answer の方向を**強制しない**。ICE 再起動や再ネゴシエーションで、どちらの側から Offer を送ってもよい(同じルームの Peer 同士なら転送する)。
- 最大4人で、接続は最大6本。

### 7.1 接続確立後のソケット

- クライアントは、WebRTC 接続が確立した後も WebSocket を**維持する**(必須)。
- 理由: 切断は退出として扱われ `peer-left` が配信されること、後から参加する人の発見に使うこと、ICE 再起動に使うこと。
- 接続確立後のシグナリングの通信量はほぼゼロ(heartbeat のみ)なので、負荷は小さい。

---

## 8. WebSocket プロトコル

- エンドポイント: `/signaling`(それ以外のパスの upgrade は 404 で拒否)。
- すべて JSON のテキストフレーム。バイナリは `INVALID_MESSAGE`。
- 形式: `{ "type": "...", ...フィールド }`(フラット。`data` でラップしない。ただし signal の中身だけは `data`)。
- 文字列フィールドは型と長さを検証する。未知のフィールドは無視する。

### 8.1 クライアント → サーバー

**create-room**(参加前の接続だけが送れる)

```json
{ "type": "create-room" }
```

**join**(参加前の接続だけが送れる)

```json
{ "type": "join", "roomId": "Xb3...22文字", "password": "ABCD-EFGH-JKLM-NPQR" }
```

**signal**(参加後のみ)

```json
{
  "type": "signal",
  "targetPeerId": "16文字のpeerId",
  "data": { "type": "offer", "sdp": "v=0..." }
}
```

**leave**

```json
{ "type": "leave" }
```

受信後に退出処理を行い、サーバー側から接続を閉じる(close code 1000)。

**ping**(任意。アプリ層の生存確認)

```json
{ "type": "ping" }
```

### 8.2 サーバー → クライアント

| type | フィールド | 説明 |
|---|---|---|
| `room-created` | `roomId`, `password`, `peerId`, `peerOrder`(=0), `peers`(=空配列) | ルーム作成成功。作成者は既に参加済み |
| `joined` | `roomId`, `peerId`, `peerOrder`, `peers: [{peerId, peerOrder}]` | 参加成功。`peers` は参加時点で既にいる Peer(自分を除く) |
| `peer-joined` | `peerId`, `peerOrder` | 新しい Peer が参加した |
| `peer-left` | `peerId` | Peer が退出・切断した |
| `signal` | `fromPeerId`, `data` | 転送されたシグナル。`data` は無加工 |
| `room-closed` | `reason` | サーバー停止などでルームが閉じる。この後サーバーが接続を閉じる |
| `error` | `code`, `message` | エラー |
| `pong` | なし | `ping` への応答 |

`room-closed.reason` は現状 `SERVER_SHUTDOWN` のみ。

### 8.3 状態遷移

```text
接続直後(未参加) ── create-room / join 成功 ──> 参加中 ── leave / 切断 ──> 終了
```

- 未参加の接続が送れるのは `create-room`、`join`、`ping` のみ。それ以外は `NOT_JOINED`。
- 参加中の接続が `create-room` / `join` を送ったら `INVALID_MESSAGE`。
- 1つの接続は1つのルームにしか入れない。

### 8.4 signal の検証と転送

サーバーは次を検証し、通ったものだけを `targetPeerId` へ転送する。**`data` の中身は変更しない**(同じオブジェクトをそのまま `JSON.stringify` して送る)。

- `targetPeerId` が `peerId` の形式で、**同じルームに存在する**こと(なければ `PEER_NOT_FOUND`)。
- `targetPeerId` が自分自身でないこと(`INVALID_SIGNAL`)。
- `data.type` が次のいずれかであること(それ以外は `INVALID_SIGNAL`)。これにより、Operation などの編集データがシグナリングに紛れ込めなくなる。
  - `offer`: `{ "type": "offer", "sdp": "<空でない文字列>" }`
  - `answer`: `{ "type": "answer", "sdp": "<空でない文字列>" }`
  - `ice-candidate`: `{ "type": "ice-candidate", "candidate": { ... } | null }`(`null` は candidate の終端を表す。`candidate` が非 null ならオブジェクトで、`candidate` / `sdpMid` / `sdpMLineIndex` などをそのまま通す)
- メッセージ全体のサイズが `MAX_MESSAGE_SIZE` 以下であること。

転送されるメッセージは `{ "type": "signal", "fromPeerId": "<送信元>", "data": { ... } }`。`fromPeerId` はサーバーが付与する(送信元が詐称できない)。

---

## 9. エラー

形式: `{ "type": "error", "code": "...", "message": "人が読める説明" }`

| code | 場面 |
|---|---|
| `INVALID_MESSAGE` | JSON でない、`type` がない・未知、フィールドの型や長さが不正、バイナリ、サイズ超過、状態に合わない操作 |
| `AUTH_FAILED` | ルームが存在しない、またはパスワードが違う(区別しない) |
| `ROOM_FULL` | 認証後に満員だった |
| `SERVER_BUSY` | `MAX_ROOMS` または `MAX_CONNECTIONS` に達している |
| `NOT_JOINED` | 未参加の接続が `signal` などを送った |
| `PEER_NOT_FOUND` | `signal` の宛先がルームにいない |
| `INVALID_SIGNAL` | `signal` の `data` の形式が不正、または自分宛 |
| `RATE_LIMITED` | レート制限や認証失敗の上限を超えた |

- エラーを返しても接続は維持する。ただし**違反**(`INVALID_MESSAGE`、`INVALID_SIGNAL`、`RATE_LIMITED`、`AUTH_FAILED`)が接続あたり `MAX_VIOLATIONS` 回を超えたら、close code 1008 で切断する。
- メッセージが `MAX_MESSAGE_SIZE` を超えた場合は `ws` が close code 1009 で切断する(エラーメッセージは返せない)。
- `message` に、パスワード・SDP・ICE Candidate の内容を含めない。

---

## 10. Heartbeat とタイムアウト

- サーバーは WebSocket のプロトコルレベルの ping を `HEARTBEAT_INTERVAL_MS`(既定 30 秒)ごとに全接続へ送る。ブラウザ / Electron / `ws` は自動で pong を返すので、クライアント側の実装は不要。
- 受信(pong・メッセージを問わず何か)が `HEARTBEAT_TIMEOUT_MS`(既定 60 秒)ないソケットは `terminate()` し、退出処理を行う。
- `HEARTBEAT_TIMEOUT_MS` は `HEARTBEAT_INTERVAL_MS` より大きくなければならない(起動時に検証し、不正ならエラー終了)。
- タイマーは全接続で**1つだけ**にする(接続ごとにタイマーを作らない)。
- 接続してから `JOIN_TIMEOUT_MS`(既定 10 秒)以内に `create-room` / `join` が成功しない接続は、close code 1008 で切断する。

---

## 11. 制限(リソース保護とレート制限)

### 11.1 容量

| 設定 | 既定 | 内容 |
|---|---|---|
| `MAX_PEERS_PER_ROOM` | 4 | 1ルームの最大人数。範囲 2〜8 |
| `MAX_ROOMS` | 20 | 同時に存在できるルーム数。超えたら `create-room` は `SERVER_BUSY` |
| `MAX_CONNECTIONS` | 100 | 同時 WebSocket 接続数。超えた upgrade は 503 で拒否 |
| `MAX_MESSAGE_SIZE` | 16384 | 1メッセージの最大バイト数(DataChannel のみの SDP は数 KB に収まる) |

### 11.2 レート制限

トークンバケット方式で実装する。キーとなる IP は「12. クライアントIPと待ち受け」で決める。

| 対象 | キー | 既定 |
|---|---|---|
| 新規 WebSocket 接続 | IP | 30 回/分。超えた upgrade は 429 で拒否 |
| `create-room` | IP | 5 回/分 |
| `join` の**失敗**(`AUTH_FAILED`) | IP | 10 回/分。超えたら `join` は `RATE_LIMITED` |
| 受信メッセージ全体 | 接続 | 30 通/秒、バースト 100 通(ICE Candidate の連続送信を考慮) |

- `join` に成功した場合は IP の失敗回数に数えない。
- レート制限用の Map は、キー数に上限を設け、満タンまで回復したキーを定期的に削除する(メモリが増え続けないようにする)。

---

## 12. クライアントIPと待ち受け

Cloudflare Tunnel 経由の場合、サーバーから見た接続元はすべて `cloudflared`(ローカル)になる。そのままではレート制限が全員まとめて数えられてしまうため、次の設定を設ける。

- `HOST`(既定 `127.0.0.1`): 待ち受けアドレス。**既定はローカルのみ**にして、`cloudflared` など同じマシン上のプロセス以外から直接つながらないようにする。
- `CLIENT_IP_HEADER`(既定は空): 設定すると、その HTTP ヘッダー(例: `CF-Connecting-IP`)の値をクライアント IP として使う(先頭の値のみ)。空なら TCP 接続の相手アドレスを使う。
- ヘッダーは偽装できるため、`CLIENT_IP_HEADER` を設定する場合は `HOST` をループバック(`127.0.0.1` / `::1`)にする必要がある。**`CLIENT_IP_HEADER` が設定されていて `HOST` がループバックでない場合は、起動時に警告ログを出す**(推奨)。
- ヘッダーが設定されているのに、リクエストにそのヘッダーがない場合は、TCP 接続の相手アドレスにフォールバックし、警告ログを1回だけ出す。
- `Origin` ヘッダーの検査は**行わない**。Electron からの接続では `Origin` が `file://` や `null` になることがあり、ブラウザ以外のクライアントなら偽装もできるため、防御として当てにならない。守りは「6. 認証」と「11. 制限」で行う。

---

## 13. 起動と停止

### 13.1 起動

```bash
npm install
node src/server.js
# 環境変数ファイルを使う場合(Node.js 22)
node --env-file=.env src/server.js
```

- 起動時に環境変数を検証し、不正な値(範囲外、`HEARTBEAT_TIMEOUT_MS` ≤ `HEARTBEAT_INTERVAL_MS` など)があれば、理由を stderr に出して終了コード 1 で終了する。
- 起動ログに、待ち受けアドレスとポートを出す。

### 13.2 停止(graceful shutdown)

`SIGINT` / `SIGTERM` を受けたら:

1. 新しい接続の受け付けを止める。
2. 全ルームの全 Peer に `room-closed`(`reason: "SERVER_SHUTDOWN"`)を送る。
3. 全接続を close code 1001 で閉じる。
4. 5 秒以内に終わらなければ強制終了する(終了コード 1)。正常に終われば 0。

### 13.3 アイドル時の自動終了(任意)

- `IDLE_SHUTDOWN_MINUTES`(既定 `0` = 無効)が 1 以上のとき、**ルームが 0 件の状態が連続して N 分続いたら**、13.2 の手順で自動終了する(終了コード 0)。
- 起動直後からカウントを始める(起動したまま誰も使わなかった場合も止まる)。
- ルームが 1 件でも作られたらカウントをリセットする。
- 判定用のタイマーは 1 つだけにする(10 秒おきに確認する程度でよい)。
- 終了する前にログへ理由を出す。

---

## 14. HTTP

必要なのは WebSocket の upgrade と、稼働確認用の 1 エンドポイントだけ。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/health` | `{ "status": "ok" }`(200)。ルーム数など内部情報は返さない |
| (upgrade) | `/signaling` | WebSocket |
| その他 | すべて | 404 |

- ルーム作成用の REST API は設けない(作成は WebSocket の `create-room` で行う)。
- ブラウザから HTTP API を叩く想定がないため、CORS ヘッダーは付けない。

---

## 15. ログ

形式: `日時 [LEVEL] メッセージ {JSON のメタ情報}`。`LOG_LEVEL` で `debug` / `info` / `warn` / `error` / `silent` を切り替える。

記録するもの:

```text
[INFO]  Server started
[INFO]  Room created
[INFO]  Peer joined / Peer left
[INFO]  Room closed
[INFO]  Shutting down(理由つき)
[WARN]  Invalid message
[WARN]  Rate limit exceeded
[WARN]  Join failed(AUTH_FAILED)
[WARN]  Heartbeat timeout
[ERROR] WebSocket error
```

**絶対に出さないもの**: パスワード、SDP、ICE Candidate の内容、`signal` の `data`。`roomId` は先頭 6 文字だけを出す。IP アドレスは、レート制限の警告などで必要な場合のみ。

---

## 16. 環境変数

| 変数 | 既定 | 内容 |
|---|---|---|
| `PORT` | `3000` | 待ち受けポート |
| `HOST` | `127.0.0.1` | 待ち受けアドレス |
| `LOG_LEVEL` | `info` | ログレベル |
| `MAX_PEERS_PER_ROOM` | `4` | 1ルームの最大人数(2〜8) |
| `MAX_ROOMS` | `20` | 同時ルーム数の上限 |
| `MAX_CONNECTIONS` | `100` | 同時接続数の上限 |
| `MAX_MESSAGE_SIZE` | `16384` | メッセージの最大バイト数(`16KB` 形式も可) |
| `JOIN_TIMEOUT_MS` | `10000` | 参加前の接続を切るまでの時間 |
| `HEARTBEAT_INTERVAL_MS` | `30000` | ping の間隔 |
| `HEARTBEAT_TIMEOUT_MS` | `60000` | 無応答で切断するまでの時間 |
| `IDLE_SHUTDOWN_MINUTES` | `0` | ルーム 0 件が続いたら自動終了(0 = 無効) |
| `CLIENT_IP_HEADER` | (空) | クライアント IP を読むヘッダー名(例: `CF-Connecting-IP`) |
| `RATE_LIMIT_CONNECT_PER_MIN` | `30` | IP あたりの接続回数 |
| `RATE_LIMIT_CREATE_PER_MIN` | `5` | IP あたりのルーム作成回数 |
| `RATE_LIMIT_JOIN_FAIL_PER_MIN` | `10` | IP あたりの参加失敗回数 |
| `RATE_LIMIT_MSG_PER_SEC` | `30` | 接続あたりの受信メッセージ数/秒 |
| `RATE_LIMIT_MSG_BURST` | `100` | 同、バースト |
| `MAX_VIOLATIONS` | `20` | 接続あたりの違反の上限 |

`.env.example` を用意する。

---

## 17. 公開方法(README に書く内容)

サーバー本体の実装範囲ではなく、README に載せる手順。

### 17.1 Cloudflare Quick Tunnel(アカウント・ドメイン不要)

```bash
node src/server.js                          # 127.0.0.1:3000 で待ち受け
cloudflared tunnel --url http://127.0.0.1:3000
# 表示された https://xxxx.trycloudflare.com を wss://xxxx.trycloudflare.com/signaling として使う
```

- `CLIENT_IP_HEADER=CF-Connecting-IP` を設定して起動する。
- URL は起動のたびに変わる。参加者には招待情報(サーバー URL 入り)で伝える。
- 注意: Quick Tunnel は SLA がなく、上限に達すると 429 が返る。固定 URL が必要なら Named Tunnel を使う。

### 17.2 Cloudflare Named Tunnel(固定 URL。任意)

- Cloudflare アカウントと、**DNS を Cloudflare に置いたドメイン**が必要。既存のドメインを使う場合は、ネームサーバーの変更と既存レコードの移行が必要になる点を README に明記する。
- 設定方法は Cloudflare の公式ドキュメントへのリンクで案内する。

### 17.3 グローバル IP のあるサーバーで直接公開(任意)

- Caddy / nginx などで TLS を終端し、`/signaling` を `127.0.0.1:3000` へ WebSocket プロキシする。
- この場合 `CLIENT_IP_HEADER` はリバースプロキシが付与するヘッダーに合わせる(使わないなら空のまま)。
- 共用・無料のサーバーを使う場合は、そのサービスの利用規約で常駐プロセスや中継用途が許されているかを各自で確認する。

### 17.4 Docker(任意)

- `Dockerfile` を用意してよい(非 root、`HEALTHCHECK` つき)が、必須ではない。優先度は低い。

---

## 18. クライアントとの契約(参考。クライアント側の仕様で確定する)

サーバー側の実装には直接関係しないが、サーバーが成り立つための前提。

- **招待情報にはサーバー URL を含める。** 参加者は作成者と同じサーバーにつながる必要があるため、`wss://…/signaling`、`roomId`、`password` の3つを1つの招待文字列(または招待 URL)にまとめて共有する。形式は未確定(例: `railmap-collab://join?server=<URLエンコードしたwss URL>&room=<roomId>&pw=<password>`)。
- **サーバー URL は設定項目**で、既定値は持たない(未設定ならオンライン共同編集は使えない旨を案内する)。
- **クライアントに秘密を埋め込まない。** URL を含め、クライアントに入っているものはすべて公開されている前提にする。
- **STUN / TURN はクライアント側の設定。** サーバーは関与しない。既定の STUN(公開されているものなど)を入れて、利用者が変更・追加できるようにする案。
- **`peer-left` はソケット切断を意味する。** WebRTC の接続状態とは別に扱う。
- **参加中はソケットを維持する**(7.1)。
- **Offer は新規参加者が送る**(7)。
- **Snapshot の提供者の選択はクライアント側のルール**(例: 参加直後に `peerOrder` が最小の既存 Peer へ要求する)。サーバーは関与しない。

---

## 19. 推奨ファイル構成

```text
signaling-server/
├── src/
│   ├── server.js          起動、HTTP、upgrade、graceful shutdown、アイドル終了
│   ├── config.js          環境変数の読み込みと検証
│   ├── room-manager.js    ルーム/Peer の管理、peerOrder 採番、signal の宛先解決(WebSocket 非依存)
│   ├── session.js         接続ごとのメッセージ検証とディスパッチ(トランスポート非依存)
│   ├── rate-limiter.js    トークンバケット
│   └── logger.js
├── test/
│   ├── room-manager.test.js
│   ├── session.test.js
│   └── websocket.test.js  実際に listen して `ws` クライアントでつなぐ結合テスト
├── .env.example
├── package.json
├── README.md
└── Dockerfile             任意
```

- ルーム管理(`room-manager.js`)は WebSocket に依存させない。接続は `send(obj)` と `close(code, reason)` だけを持つ薄いインターフェースで扱い、単体テストできるようにする。
- 規模が小さいのでファイルを減らしてもよいが、ルーム管理と WebSocket 処理は分離する。

---

## 20. テスト

`node:test` を使い、`npm test` で全件を実行できるようにする。時間に依存するテスト(heartbeat、タイムアウト、アイドル終了)は、設定値を小さくして実際に待つか、時計を注入する。

最低限、次を確認する。

1. `create-room` で `roomId` / `password` が返り、作成者が `peerOrder = 0` で参加済みになる。
2. 正しい `roomId` と `password` で `join` でき、`joined.peers` に既存 Peer が入る。既存 Peer に `peer-joined` が届く。
3. パスワードが違う、またはルームが存在しないと `AUTH_FAILED`(区別がつかない)。`roomId` だけでは参加できない。
4. 認証失敗の回数制限が効く。成功した `join` は数えない。
5. 満員で `ROOM_FULL`(認証後)。1人抜けると再び入れる。
6. `peerOrder` が単調増加し、退出後も欠番が再利用されない(4 人入って 1 人抜け、新規参加者が `4` になる)。
7. クライアントが指定した `peerId` / `peerOrder` は無視される。
8. Creator が抜けてもルームは続き、残りの Peer に `peer-left` が届く。全員が抜けたらルームが削除される。
9. `signal`(offer / answer / ice-candidate / `candidate: null`)が、**`data` を変えずに**宛先へ届き、`fromPeerId` が付く。
10. `signal` の検証: 未参加は `NOT_JOINED`、宛先不在は `PEER_NOT_FOUND`、自分宛・不正な `data.type`・SDP が空は `INVALID_SIGNAL`。編集操作のような JSON(例: `move_station`)は拒否される。
11. 不正なメッセージ(壊れた JSON、未知の `type`、バイナリ)で `INVALID_MESSAGE`。違反が上限を超えると切断される。
12. メッセージサイズ超過で切断される(1009)。
13. メッセージ・接続・ルーム作成のレート制限が効く。`CLIENT_IP_HEADER` 指定時は、そのヘッダーの IP で数えられる。
14. `MAX_ROOMS` / `MAX_CONNECTIONS` を超えると `SERVER_BUSY` / 503。
15. heartbeat: pong を返さない接続が切断され、退出処理が走る。応答する接続は切断されない。
16. 参加前の接続が `JOIN_TIMEOUT_MS` で切断される。
17. 切断・error・`leave` の後に、Peer とルームがメモリに残らない(二重の退出処理も安全)。
18. graceful shutdown で `room-closed`(`SERVER_SHUTDOWN`)が届き、プロセスが終了する。
19. `IDLE_SHUTDOWN_MINUTES` が有効なとき、ルーム 0 件が続くと終了し、ルームがあるあいだは終了しない。
20. ログに、パスワード・SDP・ICE Candidate が出ていない。
21. 起動時の環境変数検証(不正値でエラー終了)。

---

## 21. 受け入れ基準

- `npm install` のあと `node src/server.js` で起動し、`cloudflared tunnel --url` 経由で `wss://` から接続できる。
- 上の「20. テスト」が `npm test` で全件通る。
- アイドル時(ルームなし)のメモリ使用量が小さい(目安: 数十 MB 以下)。ルームが無い間はタイマー以外の処理をしない。
- 依存は `ws` のみ。
- README に、セットアップ方法、WebSocket メッセージ仕様、エラーコード、環境変数、公開方法(17章)が書かれている。
- 実装後、手動で次を確認する: 3 つのクライアント(`wscat` や小さなスクリプトで可)で、作成 → 参加 → offer / answer / ICE の交換 → 1 人退出 → 全員退出でルーム削除。

---

## 22. 非目標(実装しない)

- 路線図データ・Operation・Snapshot・編集履歴の保存、中継
- データベース、ルームの永続化、ルームの復元
- ユーザーアカウント、チャット、ファイル共有
- MediaStream(音声・映像)
- STUN / TURN サーバー機能
- Origin の検査、CAPTCHA(Turnstile など)、TLS の終端(リバースプロキシ / トンネルに任せる)
- Host 権限、ホスト移譲、強制退出
- 複数サーバー間でのルーム共有
- 一時切断からの再接続(切断は退出扱い。「23. 将来の拡張」参照)

---

## 23. 将来の拡張(v1 では実装しない。構造だけ邪魔にならないようにする)

- **再接続**: ソケットが切れても一定時間(猶予)はルームと `peerId` を保持し、再接続時に元の Peer として復帰させる。要求仕様書の未確定事項(再接続方式)が決まってから設計する。
- **TURN の認証情報の発行**: 短時間だけ有効な認証情報をサーバーが発行して `joined` に載せる(クライアントに固定の秘密を持たせないため)。
- **Workers + Durable Objects 版**: 各自の Cloudflare アカウントで動かす版。メッセージ仕様を共通にすれば置き換えられる。
- **ルーム単位のパスワード失敗回数の制限**、招待の有効期限。

---

## 24. 元の仕様からの変更点(すり合わせの記録)

最初の仕様書(ホスト方式)から、次のように変更している。

| 項目 | 元の仕様 | 本書 |
|---|---|---|
| 構成 | Host + Client | Host なし。全員対等(Full Mesh) |
| 認証 | `roomId` のみ | `roomId` + サーバー生成のパスワード |
| ルーム作成 | `POST /api/rooms` | WebSocket の `create-room`(作成者は即参加、`peerOrder = 0`)。REST は `/health` のみ |
| ホスト認証 | (なし) / `hostToken` の案 | 不要(Host がないため廃止) |
| Peer ID | クライアント指定の案もあり | サーバー生成のみ |
| Peer Order | (なし) | サーバーが単調増加で採番(欠番を再利用しない) |
| Creator 退出 | ルーム終了 | ルームは続く |
| 最大人数 | `MAX_PEERS_PER_ROOM=10` | 既定 4(2〜8) |
| シグナルの宛先 | ホストとクライアントの間のみ | 同じルーム内の任意の Peer 間 |
| Offer の方向 | ホストから | 新規参加者から(サーバーは強制しない) |
| シグナリング接続 | 確立後は切断してもよい | 参加中は**維持が必須**(切断は退出扱いのため) |
| `ROOM_TIMEOUT` | ホスト未接続ルームの破棄 | 廃止(作成と同時に参加者がいるため) |
| `HOST_LEFT` | エラーコード | 廃止 |
| Origin チェック | 必須 | 実装しない(Electron では当てにならない) |
| Docker | 必須 | 任意 |
| 公開方法 | Nginx / Caddy | Cloudflare Tunnel を主とする(`HOST=127.0.0.1`、`CLIENT_IP_HEADER`) |
| 運用 | 常時稼働を想定 | 必要なときだけ起動して止める。`IDLE_SHUTDOWN_MINUTES` を追加 |
| メッセージサイズ | 64KB | 16KB |
| `signal` の `roomId` | 毎回送る | 不要(接続がルームを知っている) |
