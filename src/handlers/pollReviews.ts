import { Request, Response } from '@google-cloud/functions-framework';
import { getGbpAuthClient } from '../auth/oauth';
import { listAccounts, listLocations, listReviews } from '../api/gbp';
import { appendReview, ensureSheetHeader, getLastPollTime, updateLastFetchTime } from '../api/sheets';
import { Review } from '../api/gbp';

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

export async function handlePollReviews(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // チェックポイントはスキャン開始時点で確定する（スキャン中に投稿されたレビューを次回に回す）
  const pollStartedAt = new Date();
  const auth = await getGbpAuthClient();

  // リクエストボディの since パラメータで基準時刻を上書き可能（キャッチアップ用）
  const sinceParam = (req.body as Record<string, unknown>)?.since as string | undefined;
  const lastPollTime = sinceParam
    ? new Date(sinceParam)
    : (await getLastPollTime() ?? new Date(Date.now() - 24 * 60 * 60 * 1000));
  console.log(`ポーリング開始: 基準時刻=${lastPollTime.toISOString()}${sinceParam ? ' (手動指定)' : ''}`);

  await ensureSheetHeader();

  const newReviews: Array<{ review: Review; businessName: string }> = [];
  const seenReviewIds = new Set<string>();   // 共有ロケーション経由の二重追記防止
  const seenLocationIds = new Set<string>();

  const accounts = await listAccounts(auth);

  for (const account of accounts) {
    // 全ロケーションをページネーションで取得
    let pageToken: string | undefined;
    let locationCount = 0;

    do {
      const { locations, nextPageToken } = await listLocations(auth, account.name, pageToken);
      locationCount += locations.length;
      pageToken = nextPageToken;

      // 20件ずつ並列でレビューを取得（レート制限対策）
      // 取得済みのロケーションは除外（同一ページ内の重複もここで除く）。seen への登録は取得成功後
      const pageIds = new Set<string>();
      const uniqueLocations = locations.filter((l) => {
        const id = l.name.split('/locations/')[1];
        if (seenLocationIds.has(id) || pageIds.has(id)) return false;
        pageIds.add(id);
        return true;
      });
      for (const batch of chunk(uniqueLocations, 20)) {
        const results = await Promise.allSettled(
          batch.map(async (location) => {
            const reviews = await listReviews(auth, location.name);
            seenLocationIds.add(location.name.split('/locations/')[1]);
            for (const review of reviews) {
              const createdAt = new Date(review.createTime);
              if (createdAt > lastPollTime && createdAt <= pollStartedAt && !seenReviewIds.has(review.reviewId)) {
                seenReviewIds.add(review.reviewId);
                newReviews.push({ review, businessName: location.title });
              }
            }
          })
        );
        // エラーのあるロケーションはスキップしてログだけ残す
        results.forEach((r, i) => {
          if (r.status === 'rejected') {
            console.warn(`スキップ: ${batch[i].name} - ${r.reason?.message ?? r.reason}`);
          }
        });
      }
    } while (pageToken);

    console.log(`アカウント ${account.name}: ${locationCount} ロケーション処理`);
  }

  // 新規レビューを投稿日時の古い順にSheetへ追記
  newReviews.sort((a, b) => new Date(a.review.createTime).getTime() - new Date(b.review.createTime).getTime());

  for (const { review, businessName } of newReviews) {
    await appendReview(review, businessName);
    console.log(`記録: ${businessName} / ${review.reviewId}`);
  }

  await updateLastFetchTime(pollStartedAt, true);

  const msg = `ポーリング完了: ${newReviews.length} 件の新規レビューを記録`;
  console.log(msg);
  res.status(200).json({ newReviewCount: newReviews.length, since: lastPollTime.toISOString() });
}
