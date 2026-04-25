# gbp-review-collect

Google Business Profile（GBP）に投稿されたレビューをリアルタイムで検知し、Google Sheets に自動記録するシステム。

## システム全体図

```text
【Googleアカウント: <GBP_ADMIN_EMAIL>】
  GBP（Google Business Profile）
  ├── アカウント: <GBP_ACCOUNT_1>
  └── アカウント: <GBP_ACCOUNT_2>
         │
         │ レビューが投稿されると通知
         ▼
【GCP プロジェクト: <GCP_PROJECT_ID>】
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
  │    │                                                    │
  │    │ レビューデータを書き込む                               │
  │    ▼                                                    │
  │  Google Sheets                                          │
  │  スプレッドシートID: <SPREADSHEET_ID>                     │
  │                                                         │
  └─────────────────────────────────────────────────────────┘
```

## 認証の仕組み

```text
【<API_ACCOUNT_EMAIL>】
  │
  │ OAuth2.0 認証（初回のみ手動で npm run auth:gbp を実行）
  ▼
GBP API へのアクセス権
  │
  │ リフレッシュトークンを保存
  ▼
Secret Manager（<GCP_PROJECT_ID> プロジェクト）
  gbp-refresh-token
  │
  │ Cloud Functions 実行時に自動取得
  ▼
GBP API 呼び出し（レビュー取得）

---

Cloud Functions の Google Sheets アクセス:
  Cloud Functions サービスアカウント: <SERVICE_ACCOUNT>
  │
  │ ADC（Application Default Credentials）で自動認証
  ▼
Google Sheets 書き込み
※ スプレッドシートに上記サービスアカウントを編集者として共有済み
```

## 各サービスの役割

| サービス | 役割 | 管理場所 |
|---------|------|---------|
| GBP | レビューの発生元。新着レビューを Pub/Sub に通知する | Google ビジネスプロフィール管理画面 |
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

> **重要**: OAuth 同意画面を「本番環境」に昇格させると、トークンの期限切れがなくなります。現在はテストモードのため 7 日ごとに `npm run auth:gbp` が必要です。

### 変わらない設定値（メモとして）

実際の値は `.env` および Secret Manager で管理してください。

| 項目 | 変数名 / シークレット名 |
|------|----------------------|
| GCP プロジェクト ID | `GCP_PROJECT_ID` |
| Pub/Sub トピック | `gbp-review-notifications` |
| Cloud Functions 名 | `reviewNotification` |
| リージョン | `asia-northeast1` |
| スプレッドシート ID | `SPREADSHEET_ID` |
| Cloud Functions SA | `<SERVICE_ACCOUNT>`（GCP コンソールで確認） |
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
- gcloud CLI（初期設定済み）
- GBP API のアクセス権限を Google から取得済み（プロジェクト単位で審査あり）
- GCP プロジェクト作成済み・必要な API 有効化済み

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
| `GCP_PROJECT_ID` | GCPプロジェクトID |
| `SPREADSHEET_ID` | Google SheetsのID（URLの `/d/` と `/edit` の間の文字列） |
| `SHEET_NAME` | シート名（デフォルト: `レビュー一覧`） |
| `PUBSUB_TOPIC` | Pub/SubトピックID（デフォルト: `gbp-review-notifications`） |

### 3. Pub/Sub トピックへの GBP 通知権限付与（初回のみ）

```bash
gcloud pubsub topics add-iam-policy-binding gbp-review-notifications \
  --member="serviceAccount:mybusiness-api-pubsub@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project=<GCP_PROJECT_ID>
```

### 4. OAuth 認証（リフレッシュトークン取得）

```bash
npm run auth:gbp
```

ブラウザが開くので GBP API 用アカウント（`<API_ACCOUNT_EMAIL>`）でログイン。リフレッシュトークンは自動的に Secret Manager に保存される。

> **注意**: OAuth 同意画面がテストモードの場合、トークンは **7日で失効** します。失効したら再度このコマンドを実行してください。

### 5. GBP 通知登録

```bash
npm run register-notifications
```

全 GBP アカウントに対して Pub/Sub 通知設定を登録する。

### 6. Cloud Functions デプロイ

`GBP_CLIENT_SECRET` は環境変数として直接渡さず、Secret Manager 経由でバインドします。

**事前準備**: `GBP_CLIENT_SECRET` を Secret Manager に登録し、Cloud Functions SA にアクセス権を付与する。

```bash
# シークレット登録
echo -n "YOUR_CLIENT_SECRET" | gcloud secrets create gbp-client-secret \
  --data-file=- --project=<GCP_PROJECT_ID>

# Cloud Functions SA にアクセス権付与
gcloud secrets add-iam-policy-binding gbp-client-secret \
  --member="serviceAccount:<SERVICE_ACCOUNT>" \
  --role="roles/secretmanager.secretAccessor" \
  --project=<GCP_PROJECT_ID>
```

**デプロイ**:

```bash
npm run build
gcloud functions deploy reviewNotification \
  --gen2 \
  --runtime=nodejs22 \
  --region=asia-northeast1 \
  --source=. \
  --entry-point=reviewNotification \
  --trigger-topic=gbp-review-notifications \
  --project=<GCP_PROJECT_ID> \
  --set-env-vars="SPREADSHEET_ID=<SPREADSHEET_ID>,GBP_CLIENT_ID=<GBP_CLIENT_ID>" \
  --set-secrets="GBP_CLIENT_SECRET=gbp-client-secret:latest"
```

### 7. Google Sheets へのアクセス権付与

Cloud Functions のサービスアカウント（`<SERVICE_ACCOUNT>`）をスプレッドシートの編集者として共有する。

## Google Sheets の出力形式

| A: 取得日時 | B: 投稿日時 | C: ビジネス名 | D: 評価（数字） | E: 評価（星） | F: 投稿者名 | G: コメント | H: 返信 |
|------------|------------|--------------|----------------|--------------|------------|------------|--------|
| 2024/01/15 10:30 | 2024/01/15 09:00 | 店舗名 | 5 | ★★★★★ | 田中太郎 | 素晴らしい！ | ありがとうございます |

- A1 セルに最終取得日時を表示
- レビュー投稿のたびに末尾に 1 行追記

## 注意事項

- GBP API は Google による審査・承認が必要（プロジェクト単位で承認される）
- OAuth のリフレッシュトークンは Secret Manager で管理（コードやファイルに含めない）
- `GBP_CLIENT_SECRET` は `--set-secrets` でバインドし、環境変数として平文で渡さない
- `.env` は `.gitignore` に追加済み
