# gbp-review-collect

Google Business Profile（GBP）に投稿されたレビューをリアルタイムで検知し、Google Sheets に自動記録するシステム。

## Googleアカウントの役割

| アカウント | メールアドレス | 役割 |
|-----------|--------------|------|
| **APIアカウント** | `yk110303@gmail.com` | GCPプロジェクト（`oaky-gmb`）のオーナー。GBP API の審査・承認を受けたアカウント。OAuthクライアントIDもこのアカウントで作成。 |
| **GBPアカウント** | `kutikomikannri02@gmail.com` | Google Business Profile を実際に管理するアカウント。1,000件以上の店舗を管理しており、レビュー通知の登録対象。 |

### どの処理をどのアカウントで行うか

| 処理 | 使用アカウント | 備考 |
|------|--------------|------|
| GCP コンソール操作（API有効化、Cloud Functions デプロイ等） | `yk110303@gmail.com`（APIアカウント） | GCPプロジェクトのオーナー |
| `npm run auth:gbp`（OAuth認証） | `kutikomikannri02@gmail.com`（GBPアカウント） | **ブラウザで必ずGBPアカウントでログイン**。このアカウントのリフレッシュトークンを Secret Manager に保存する |
| `npm run register-notifications`（通知登録） | 自動（`auth:gbp` で取得したトークンを使用） | GBPアカウントが管理する全店舗に通知を登録 |
| Google Sheets 操作 | Cloud Functions SA（自動） | Cloud Functions のサービスアカウントで ADC 認証 |

> **重要**: `npm run auth:gbp` 実行時にブラウザで開くログイン画面では、必ず `kutikomikannri02@gmail.com`（GBPアカウント）でログインすること。`yk110303@gmail.com` でログインすると、店舗を管理していないアカウントのトークンが保存され、通知登録が正しく機能しない。

---

## システム全体図

```text
【GBPアカウント: kutikomikannri02@gmail.com】
  GBP（Google Business Profile）
  └── 管理する全店舗（1,000件以上）
         │
         │ レビューが投稿されると通知
         ▼
【GCPプロジェクト: oaky-gmb（APIアカウント: yk110303@gmail.com が管理）】
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │  Pub/Sub トピック                                        │
  │  gbp-review-notifications                               │
  │    │                                                    │
  │    │ メッセージを受信すると自動起動                          │
  │    ▼                                                    │
  │  Cloud Functions                                        │
  │  reviewNotification                                     │
  │    │                         │                         │
  │    │ レビュー詳細を取得          │ 認証トークンを取得          │
  │    ▼                         ▼                         │
  │  GBP API                  Secret Manager               │
  │  mybusiness.googleapis.com  gbp-refresh-token          │
  │    │                        （GBPアカウントのトークン）     │
  │    │ レビューデータを書き込む                               │
  │    ▼                                                    │
  │  Google Sheets                                          │
  │  スプレッドシートID: 1tXSHtXuXmjopJ5nfZayc_VdiSwtjWUIqEMThJHV0m64  │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

## 認証の仕組み

```text
【GBPアカウント: kutikomikannri02@gmail.com】
  │
  │ OAuth2.0 認証（npm run auth:gbp を手動実行）
  ▼
GBP API へのアクセス権（管理する全店舗のレビュー取得権限）
  │
  │ リフレッシュトークンを保存
  ▼
Secret Manager（oaky-gmb プロジェクト）
  gbp-refresh-token
  │
  │ Cloud Functions 実行時に自動取得
  ▼
GBP API 呼び出し（レビュー詳細取得）

---

Cloud Functions の Google Sheets アクセス:
  Cloud Functions サービスアカウント: 429122503904-compute@developer.gserviceaccount.com
  │
  │ ADC（Application Default Credentials）で自動認証
  ▼
Google Sheets 書き込み
※ スプレッドシートに上記サービスアカウントを編集者として共有済み
```

## 各サービスの役割

| サービス | 役割 | 管理場所 |
|---------|------|---------|
| GBP | レビューの発生元。新着レビューを Pub/Sub に通知する | Google ビジネスプロフィール管理画面（GBPアカウントでログイン） |
| Pub/Sub | GBP からの通知メッセージを受け取るキュー | GCP コンソール > Pub/Sub |
| Cloud Functions | Pub/Sub のメッセージを受け取り、レビューをシートに書く処理本体 | GCP コンソール > Cloud Functions |
| Secret Manager | OAuth リフレッシュトークンを安全に保管 | GCP コンソール > Secret Manager |
| GBP API | レビューの詳細データを取得する | GCP コンソール > APIとサービス |
| Google Sheets | レビューの記録先 | Google スプレッドシート |

## 手元に残しておくべき情報

### 定期メンテナンスが必要なもの

| 情報 | 内容 | なぜ必要か |
|------|------|-----------|
| OAuth リフレッシュトークン | Secret Manager に保存済み | **テストモードの場合7日で失効**するため `npm run auth:gbp` で再発行が必要 |
| GBP_CLIENT_ID / GBP_CLIENT_SECRET | `.env` ファイルに保存 | 再認証時・再デプロイ時に必要 |

> **重要**: OAuth 同意画面を「本番環境」に昇格させると、トークンの期限切れがなくなります。現在はテストモードのため 7 日ごとに `npm run auth:gbp` が必要です。その際も必ず `kutikomikannri02@gmail.com` でログインしてください。

### 固定の設定値

| 項目 | 値 |
|------|---|
| GCPプロジェクトID | `oaky-gmb` |
| Pub/Sub トピック | `gbp-review-notifications` |
| Cloud Functions 名 | `reviewNotification` |
| リージョン | `asia-northeast1` |
| スプレッドシートID | `1tXSHtXuXmjopJ5nfZayc_VdiSwtjWUIqEMThJHV0m64` |
| Cloud Functions SA | `429122503904-compute@developer.gserviceaccount.com` |
| GBP 通知用 SA | `mybusiness-api-pubsub@system.gserviceaccount.com` |

## 技術スタック

- **言語**: Node.js / TypeScript
- **インフラ**: Google Cloud Platform
  - Cloud Functions gen2（メイン処理）
  - Pub/Sub（プッシュ通知受信）
  - Secret Manager（OAuthトークン管理）
- **出力**: Google Sheets
- **認証**: OAuth 2.0

## プロジェクト構成

```text
gbp-review-collect/
├── scripts/
│   ├── auth-init.ts              # OAuth初回認証・リフレッシュトークン取得
│   └── register-notifications.ts # GBP通知登録
├── src/
│   ├── auth/oauth.ts             # Secret ManagerからOAuthクライアント生成
│   ├── api/gbp.ts                # GBP API（アカウント・レビュー取得）
│   ├── api/sheets.ts             # Google Sheetsへの書き込み
│   ├── handlers/
│   │   └── reviewNotification.ts # Cloud Functionsエントリーポイント
│   └── index.ts
├── .env.example
├── package.json
└── tsconfig.json
```

## セットアップ手順

### 前提条件

- Node.js 22+
- gcloud CLI（初期設定済み・`yk110303@gmail.com` でログイン済み）
- GBP API のアクセス権限を Google から取得済み（プロジェクト単位で審査あり）
- GCP プロジェクト（`oaky-gmb`）作成済み・必要な API 有効化済み

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
# .env を編集して各値を入力
```

| 変数名 | 説明 |
|--------|------|
| `GBP_CLIENT_ID` | OAuth クライアントID（GCP コンソール > APIとサービス > 認証情報） |
| `GBP_CLIENT_SECRET` | OAuth クライアントシークレット |
| `GCP_PROJECT_ID` | `oaky-gmb` |
| `SPREADSHEET_ID` | `1tXSHtXuXmjopJ5nfZayc_VdiSwtjWUIqEMThJHV0m64` |
| `SHEET_NAME` | `レビュー一覧` |
| `PUBSUB_TOPIC` | `gbp-review-notifications` |

### 3. Pub/Sub トピックへの GBP 通知権限付与（初回のみ）

```bash
gcloud pubsub topics add-iam-policy-binding gbp-review-notifications \
  --member="serviceAccount:mybusiness-api-pubsub@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project=oaky-gmb
```

### 4. OAuth 認証（リフレッシュトークン取得）

```bash
npm run auth:gbp
```

ブラウザが開くので **`kutikomikannri02@gmail.com`（GBPアカウント）でログイン**。  
リフレッシュトークンは自動的に Secret Manager（`gbp-refresh-token`）に保存される。

> **注意**: `yk110303@gmail.com`（APIアカウント）でログインしないこと。店舗を管理していないアカウントのトークンが保存され、通知登録が機能しない。

> **注意**: OAuth 同意画面がテストモードの場合、トークンは **7日で失効** します。失効したら再度このコマンドを `kutikomikannri02@gmail.com` でログインして実行してください。

### 5. GBP 通知登録

```bash
npm run register-notifications
```

`kutikomikannri02@gmail.com` が管理する全 GBP アカウント・全店舗に対して Pub/Sub 通知設定を登録する。

### 6. Cloud Functions デプロイ

```bash
gcloud functions deploy reviewNotification \
  --gen2 \
  --runtime=nodejs22 \
  --region=asia-northeast1 \
  --source=. \
  --entry-point=reviewNotification \
  --trigger-topic=gbp-review-notifications \
  --project=oaky-gmb \
  --update-env-vars="SPREADSHEET_ID=1tXSHtXuXmjopJ5nfZayc_VdiSwtjWUIqEMThJHV0m64,GBP_CLIENT_ID=<GBP_CLIENT_ID>,GCP_PROJECT_ID=oaky-gmb,PUBSUB_TOPIC=gbp-review-notifications,SHEET_NAME=レビュー一覧"
```

### 7. Google Sheets へのアクセス権付与

Cloud Functions のサービスアカウント（`429122503904-compute@developer.gserviceaccount.com`）をスプレッドシートの編集者として共有する。

## Google Sheets の出力形式

| A: 取得日時 | B: 投稿日時 | C: ビジネス名 | D: 評価（数字） | E: 評価（星） | F: 投稿者名 | G: コメント | H: 返信 |
|------------|------------|--------------|----------------|--------------|------------|------------|--------|
| 2024/01/15 10:30 | 2024/01/15 09:00 | 店舗名 | 5 | ★★★★★ | 田中太郎 | 素晴らしい！ | ありがとうございます |

- A1 セルに最終取得日時を表示
- レビュー投稿のたびに末尾に 1 行追記

## 注意事項

- GBP API は Google による審査・承認が必要（プロジェクト単位で承認される）
- OAuth のリフレッシュトークンは Secret Manager で管理（コードやファイルに含めない）
- `.env` は `.gitignore` に追加済み
