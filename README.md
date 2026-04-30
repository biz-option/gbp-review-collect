# gbp-review-collect

Google Business Profile（GBP）に投稿されたレビューを自動収集し、Google Sheets に記録するシステム。

## Googleアカウントの役割

| アカウント | メールアドレス | 役割 |
|-----------|--------------|------|
| **APIアカウント** | `yk110303@gmail.com` | GCPプロジェクト（`oaky-gmb`）のオーナー。GBP API の審査・承認を受けたアカウント。 |
| **GBPアカウント** | `kutikomikannri02@gmail.com` | Google Business Profile を実際に管理するアカウント。21店舗を管理。 |

---

## システム全体図

```text
Cloud Scheduler（30分ごと）
  │
  │ HTTP POST トリガー
  ▼
Cloud Functions: pollReviews
  │
  ├─ GBP API（全ロケーションのレビュー一覧取得）
  │    mybusiness.googleapis.com/v4
  │
  ├─ Secret Manager（GBPアカウントのOAuthトークン取得）
  │    gbp-refresh-token
  │
  └─ Google Sheets（新規レビューを1行追記）
       スプレッドシートID: 1tXSHtXuXmjopJ5nfZayc_VdiSwtjWUIqEMThJHV0m64
```

> **サブ機能（Pub/Sub）**: GBPからPush通知が届いた場合も `reviewNotification` が処理する。
> ただし現状ではGBP側の通知が不安定なため、ポーリングがメインの取得手段。

---

## 認証の仕組み

```text
kutikomikannri02@gmail.com
  │
  │ npm run auth:gbp（初回・トークン失効時に手動実行）
  ▼
Secret Manager: gbp-refresh-token
  │
  │ Cloud Functions 実行時に自動取得
  ▼
GBP API 呼び出し

---

Cloud Functions → Google Sheets:
  サービスアカウント: 429122503904-compute@developer.gserviceaccount.com
  ADC（Application Default Credentials）で自動認証
```

---

## Google Sheets の構造

| セル | 内容 |
|------|------|
| A1 | `最終更新: YYYY/MM/DD HH:MM`（人間向け表示） |
| B1 | ISO 8601タイムスタンプ（ポーリング基準時刻、システム用） |
| A2:H2 | ヘッダー行 |
| A3以降 | レビューデータ（1行1件、投稿日時の古い順） |

### 出力カラム

| A: 取得日時 | B: 投稿日時 | C: ビジネス名 | D: 評価（数字） | E: 評価（星） | F: 投稿者名 | G: コメント | H: 返信 |
|------------|------------|--------------|----------------|--------------|------------|------------|--------|

---

## 各サービスの役割

| サービス | 役割 |
|---------|------|
| Cloud Scheduler | 30分ごとに `pollReviews` をキック |
| Cloud Functions: `pollReviews` | 全ロケーションのレビューをポーリングしてSheetに追記 |
| Cloud Functions: `reviewNotification` | GBP Push通知（Pub/Sub）受信時のサブ処理 |
| GBP API | レビューデータの取得元 |
| Secret Manager | GBPアカウントのOAuthリフレッシュトークンを保管 |
| Pub/Sub | GBP通知の受け口（`gbp-review-notifications`） |
| Google Sheets | レビューの記録先 |

---

## プロジェクト構成

```text
gbp-review-collect/
├── scripts/
│   ├── auth-init.ts              # OAuth認証・リフレッシュトークン取得
│   └── register-notifications.ts # GBP Push通知登録
├── src/
│   ├── auth/oauth.ts             # Secret ManagerからOAuthクライアント生成
│   ├── api/
│   │   ├── gbp.ts                # GBP API（ロケーション一覧・レビュー取得）
│   │   └── sheets.ts             # Google Sheets読み書き
│   ├── handlers/
│   │   ├── pollReviews.ts        # ポーリング処理（メイン）
│   │   └── reviewNotification.ts # Pub/Sub通知ハンドラ（サブ）
│   └── index.ts
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 固定の設定値

| 項目 | 値 |
|------|---|
| GCPプロジェクトID | `oaky-gmb` |
| リージョン | `asia-northeast1` |
| Cloud Functions: pollReviews | `https://pollreviews-7qetc7s5ba-an.a.run.app` |
| Cloud Functions: reviewNotification | `https://reviewnotification-7qetc7s5ba-an.a.run.app` |
| Cloud Scheduler ジョブ | `gbp-review-poll`（`*/30 * * * *`） |
| Pub/Sub トピック | `gbp-review-notifications` |
| スプレッドシートID | `1tXSHtXuXmjopJ5nfZayc_VdiSwtjWUIqEMThJHV0m64` |
| サービスアカウント | `429122503904-compute@developer.gserviceaccount.com` |

---

## セットアップ手順

### 前提条件

- Node.js 22+
- gcloud CLI（`yk110303@gmail.com` でログイン済み）
- GBP API のアクセス権限取得済み（プロジェクト単位で Google 審査あり）

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
| `GBP_CLIENT_ID` | OAuth クライアントID |
| `GBP_CLIENT_SECRET` | OAuth クライアントシークレット |
| `GCP_PROJECT_ID` | `oaky-gmb` |
| `SPREADSHEET_ID` | スプレッドシートID |
| `SHEET_NAME` | `レビュー一覧` |
| `PUBSUB_TOPIC` | `gbp-review-notifications` |

### 3. OAuth 認証（初回・トークン失効時）

```bash
npm run auth:gbp
```

ブラウザが開くので **`kutikomikannri02@gmail.com` でログイン**。  
リフレッシュトークンは Secret Manager（`gbp-refresh-token`）に自動保存される。

> **注意**: OAuth 同意画面がテストモードの場合、トークンは **7日で失効**。  
> 失効後は再度このコマンドを `kutikomikannri02@gmail.com` でログインして実行する。

### 4. GBP Push通知登録（任意）

```bash
npm run register-notifications
```

GBPアカウントが管理する全店舗に Pub/Sub 通知設定を登録する。  
（ポーリング方式で運用する場合は不要）

### 5. Cloud Functions デプロイ

#### pollReviews（ポーリング処理）

```bash
gcloud functions deploy pollReviews \
  --gen2 --runtime=nodejs22 \
  --region=asia-northeast1 \
  --source=. \
  --entry-point=pollReviews \
  --trigger-http \
  --no-allow-unauthenticated \
  --timeout=300s \
  --project=oaky-gmb \
  --set-env-vars="GBP_CLIENT_ID=<値>,GBP_CLIENT_SECRET=<値>,GCP_PROJECT_ID=oaky-gmb,SPREADSHEET_ID=<値>,SHEET_NAME=レビュー一覧"
```

#### reviewNotification（Pub/Sub通知ハンドラ）

```bash
gcloud functions deploy reviewNotification \
  --gen2 --runtime=nodejs22 \
  --region=asia-northeast1 \
  --source=. \
  --entry-point=reviewNotification \
  --trigger-topic=gbp-review-notifications \
  --project=oaky-gmb \
  --set-env-vars="GBP_CLIENT_ID=<値>,GBP_CLIENT_SECRET=<値>,GCP_PROJECT_ID=oaky-gmb,SPREADSHEET_ID=<値>,SHEET_NAME=レビュー一覧"
```

### 6. Cloud Scheduler 設定

```bash
gcloud scheduler jobs create http gbp-review-poll \
  --schedule="*/30 * * * *" \
  --uri="https://pollreviews-7qetc7s5ba-an.a.run.app" \
  --http-method=POST \
  --project=oaky-gmb \
  --location=asia-northeast1 \
  --oidc-service-account-email=429122503904-compute@developer.gserviceaccount.com \
  --oidc-token-audience="https://pollreviews-7qetc7s5ba-an.a.run.app" \
  --attempt-deadline=300s
```

### 7. Google Sheets へのアクセス権付与

サービスアカウント `429122503904-compute@developer.gserviceaccount.com` をスプレッドシートの編集者として共有する。

---

## 運用メモ

### 過去分のキャッチアップ方法

B1 の基準時刻より古いレビューを取り込みたい場合：

```bash
# 1. ジョブに since パラメータを設定して手動実行
gcloud scheduler jobs update http gbp-review-poll \
  --project=oaky-gmb --location=asia-northeast1 \
  --message-body='{"since":"2026-04-01T00:00:00.000Z"}' \
  --update-headers="Content-Type=application/json"

gcloud scheduler jobs run gbp-review-poll \
  --project=oaky-gmb --location=asia-northeast1

# 2. 完了後、ジョブを通常モードに戻す（削除して再作成）
gcloud scheduler jobs delete gbp-review-poll \
  --project=oaky-gmb --location=asia-northeast1 --quiet

gcloud scheduler jobs create http gbp-review-poll \
  --schedule="*/30 * * * *" \
  --uri="https://pollreviews-7qetc7s5ba-an.a.run.app" \
  --http-method=POST \
  --project=oaky-gmb --location=asia-northeast1 \
  --oidc-service-account-email=429122503904-compute@developer.gserviceaccount.com \
  --oidc-token-audience="https://pollreviews-7qetc7s5ba-an.a.run.app" \
  --attempt-deadline=300s
```

---

## 注意事項

- GBP API は Google による審査・承認が必要（プロジェクト単位）
- OAuth リフレッシュトークンは Secret Manager で管理（コード・ファイルに含めない）
- `.env` は `.gitignore` に追加済み
