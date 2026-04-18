# gbp-review-collect

Google Business Profile（GBP）に投稿されたレビューをリアルタイムで検知し、Google Sheets に自動記録するシステム。

## アーキテクチャ

```
GBPレビュー投稿
    ↓
GBP Push Notification API（Pub/Sub へ送信）
    ↓
Pub/Sub Topic
    ↓ 自動トリガー
Cloud Functions（Node.js/TypeScript）
    ↓
GBP API（レビュー詳細取得）
    ↓
Google Sheets（1行追記）
```

## 技術スタック

- **言語**: Node.js / TypeScript
- **インフラ**: Google Cloud Platform
  - Cloud Functions（メイン処理）
  - Pub/Sub（プッシュ通知受信）
  - Secret Manager（OAuthトークン管理）
- **出力**: Google Sheets
- **認証**: OAuth 2.0

## プロジェクト構成

```
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

- Node.js 20+
- gcloud CLI（初期設定済み）
- GBP APIのアクセス権限をGoogleから取得済み
- GCPプロジェクト作成済み・必要なAPI有効化済み

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
| `GBP_CLIENT_ID` | OAuth クライアントID（GCP コンソールで取得） |
| `GBP_CLIENT_SECRET` | OAuth クライアントシークレット |
| `GMAIL_CLIENT_ID` | Gmail用 OAuth クライアントID（GBPと同じで可） |
| `GMAIL_CLIENT_SECRET` | Gmail用 OAuth クライアントシークレット |
| `GCP_PROJECT_ID` | GCPプロジェクトID |
| `SPREADSHEET_ID` | Google SheetsのID（URLから取得） |
| `SHEET_NAME` | シート名（デフォルト: `レビュー一覧`） |
| `PUBSUB_TOPIC` | Pub/SubトピックID（デフォルト: `gbp-review-notifications`） |

### 3. GCP アプリケーションデフォルト認証

```bash
gcloud auth application-default login
```

### 4. OAuth初回認証（リフレッシュトークン取得）

GBP API用：
```bash
npm run auth:gbp
```

Gmail API用（フォールバック実装時）：
```bash
npm run auth:gmail
```

ブラウザが開くので対象のGoogleアカウントでログイン。リフレッシュトークンは自動的に Secret Manager に保存される。

> **注意**: OAuth同意画面のテストユーザーに対象アカウントを追加しておく必要あり。

### 5. Pub/Sub トピック作成

```bash
gcloud pubsub topics create gbp-review-notifications --project=YOUR_PROJECT_ID
```

### 6. GBP 通知登録

```bash
npm run register-notifications
```

全GBPアカウントに対してPub/Sub通知設定を登録する。

### 7. Cloud Functions デプロイ

```bash
npm run build
gcloud functions deploy reviewNotification \
  --gen2 \
  --runtime=nodejs20 \
  --region=asia-northeast1 \
  --source=. \
  --entry-point=reviewNotification \
  --trigger-topic=gbp-review-notifications \
  --set-env-vars GCP_PROJECT_ID=YOUR_PROJECT_ID,SPREADSHEET_ID=YOUR_SPREADSHEET_ID \
  --project=YOUR_PROJECT_ID
```

## Google Sheets の出力形式

| A: 取得日時 | B: 投稿日時 | C: ビジネス名 | D: 評価（数字） | E: 評価（星） | F: 投稿者名 | G: コメント | H: 返信 |
|------------|------------|--------------|----------------|--------------|------------|------------|--------|
| 2024/01/15 10:30 | 2024/01/15 09:00 | 店舗名 | 5 | ★★★★★ | 田中太郎 | 素晴らしい！ | ありがとうございます |

- A1セルに最終取得日時を表示
- レビュー投稿のたびに末尾に1行追記

## 使用するGBP APIエンドポイント

| 用途 | エンドポイント |
|------|--------------|
| アカウント一覧 | `mybusinessaccountmanagement.googleapis.com/v1/accounts` |
| 通知設定 | `mybusinessnotifications.googleapis.com/v1/{account}/notificationSetting` |
| レビュー取得 | `mybusinessbusinessinformation.googleapis.com/v1/{review}` |

## 注意事項

- GBP APIはGoogleによる審査・承認が必要（プロジェクト単位で承認される）
- OAuthのリフレッシュトークンは Secret Manager で管理（コードやファイルに含めない）
- `.env` は `.gitignore` および `.claudeignore` に追加済み
