import { Request, Response } from '@google-cloud/functions-framework';
import { getGbpAuthClient } from '../auth/oauth';
import { getReview } from '../api/gbp';
import { appendReview, ensureSheetHeader, updateLastFetchTime } from '../api/sheets';

interface PubSubMessage {
  data: string;  // base64エンコード
  messageId: string;
  publishTime: string;
}

interface PubSubBody {
  message: PubSubMessage;
  subscription: string;
}

// GBP Push Notification のペイロード形式
interface GbpNotification {
  name: string;        // "accounts/{accountId}/locations/{locationId}"
  type: string;        // "NEW_REVIEW" | "UPDATED_REVIEW" | etc.
  reviewId?: string;
}

export async function handleReviewNotification(req: Request, res: Response): Promise<void> {
  // Pub/Sub は POST のみ受け付ける
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  let notification: GbpNotification;

  try {
    const body = req.body as PubSubBody;

    if (!body.message?.data) {
      console.error('Pub/Sub メッセージにdataがありません');
      // 200を返さないとPub/Subがリトライし続けるため、不正メッセージは200で捨てる
      res.status(200).send('invalid message');
      return;
    }

    const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
    notification = JSON.parse(decoded) as GbpNotification;
    console.log('受信通知:', JSON.stringify(notification));
  } catch (err) {
    console.error('メッセージ解析エラー:', err);
    res.status(200).send('parse error');
    return;
  }

  // NEW_REVIEW / UPDATED_REVIEW のみ処理
  if (!notification.type?.includes('REVIEW') || !notification.reviewId) {
    console.log(`スキップ (type=${notification.type})`);
    res.status(200).send('skipped');
    return;
  }

  try {
    const auth = await getGbpAuthClient();

    // レビュー詳細を取得
    const reviewName = `${notification.name}/reviews/${notification.reviewId}`;
    const review = await getReview(auth, reviewName);

    // ビジネス名を location の name から抽出（後で locations API から取得するよう拡張可）
    // notification.name = "accounts/{accountId}/locations/{locationId}"
    const locationId = notification.name.split('/').pop() ?? notification.name;
    const businessName = locationId; // TODO: locations APIでtitleを取得

    // Google Sheets に追記（ヘッダーがなければ自動作成）
    await ensureSheetHeader();
    await appendReview(review, businessName);

    // 最終取得日時を更新
    await updateLastFetchTime();

    console.log(`✓ レビュー記録完了: ${review.reviewId}`);
    res.status(200).send('ok');
  } catch (err) {
    console.error('処理エラー:', err);
    // 500を返すとPub/Subがリトライする（意図的）
    res.status(500).send('internal error');
  }
}
