import { google } from 'googleapis';
import { Review, starToNumber, stripGoogleTranslation } from './gbp';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const SHEET_NAME = process.env.SHEET_NAME || 'レビュー一覧';

const HEADER_ROW = ['取得日時', '投稿日時', 'ビジネス名', '評価（数字）', '評価（星）', '投稿者名', 'コメント', '返信', 'レビューID'];

function toStars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function formatJst(isoString: string): string {
  return new Date(isoString).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function ensureSheetHeader(): Promise<void> {
  const sheets = getSheetsClient();

  // 2行目にヘッダーがなければ書き込む（1行目は最終更新日時用）
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:I2`,
  });

  // 空、または旧ヘッダー(I列「レビューID」なし)なら書き込む
  if (!res.data.values || res.data.values.length === 0 || res.data.values[0].length < HEADER_ROW.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] },
    });
  }
}

export async function getLastPollTime(): Promise<Date | null> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!B1`,
  });
  const val = res.data.values?.[0]?.[0] as string | undefined;
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 最終更新表示(A1)を更新する。ポーリング基準時刻(B1)は advanceCheckpoint=true のとき（pollReviews のみ）だけ進める。
 * 通知ハンドラが B1 を進めると、ポーリングが未取得のレビューを飛ばすため。
 */
export async function updateLastFetchTime(
  now: Date = new Date(),
  advanceCheckpoint = false
): Promise<void> {
  const sheets = getSheetsClient();
  const data = [
    { range: `${SHEET_NAME}!A1`, values: [[`最終更新: ${formatJst(now.toISOString())}`]] },
  ];

  // 並行実行されたハンドラが新しい時刻を書いていたら巻き戻さない（Sheets に CAS は無いので best effort）
  if (advanceCheckpoint) {
    const stored = await getLastPollTime();
    if (!stored || stored < now) {
      data.push({ range: `${SHEET_NAME}!B1`, values: [[now.toISOString()]] });
    }
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

/** 旧データ(I列にレビューIDが無い行)との照合用キー: 投稿日時|ビジネス名|投稿者名 */
function fallbackKey(postedAt: string, businessName: string, reviewer: string): string {
  return `${postedAt}|${businessName}|${reviewer}`;
}

/** 記録済みレビューの照合用データ。ID は I列、旧行は B/C/F列のキーで判定する */
export interface RecordedReviews {
  ids: Set<string>;
  fallbackKeys: Set<string>;
}

/** シートの記録済みレビューを一括取得する（重複排除用） */
export async function getRecordedReviews(): Promise<RecordedReviews> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A3:I`,
  });
  const ids = new Set<string>();
  const fallbackKeys = new Set<string>();
  for (const row of res.data.values ?? []) {
    const id = row[8] as string | undefined;
    if (id) ids.add(String(id));
    else fallbackKeys.add(fallbackKey(row[1] ?? '', row[2] ?? '', row[5] ?? ''));
  }
  return { ids, fallbackKeys };
}

/** 記録済みか判定する。ID があれば ID のみ、旧行は日時+ビジネス名+投稿者名で判定 */
export function isRecorded(recorded: RecordedReviews, review: Review, businessName: string): boolean {
  if (recorded.ids.has(review.reviewId)) return true;
  const reviewer = review.reviewer.isAnonymous ? '匿名ユーザー' : review.reviewer.displayName;
  return recorded.fallbackKeys.has(fallbackKey(formatJst(review.createTime), businessName, reviewer));
}

function toRow(review: Review, businessName: string): Array<string | number> {
  const starNum = starToNumber(review.starRating);
  const reviewer = review.reviewer.isAnonymous ? '匿名ユーザー' : review.reviewer.displayName;
  return [
    formatJst(new Date().toISOString()),
    formatJst(review.createTime),
    businessName,
    starNum,
    toStars(starNum),
    reviewer,
    stripGoogleTranslation(review.comment),
    stripGoogleTranslation(review.reviewReply?.comment),
    review.reviewId,
  ];
}

const APPEND_CHUNK_SIZE = 500;

/** 複数レビューを APPEND_CHUNK_SIZE 件ずつまとめて追記する（書き込みAPIの回数・レート制限対策） */
export async function appendReviews(
  items: Array<{ review: Review; businessName: string }>
): Promise<void> {
  const sheets = getSheetsClient();
  for (let i = 0; i < items.length; i += APPEND_CHUNK_SIZE) {
    const values = items.slice(i, i + APPEND_CHUNK_SIZE).map(({ review, businessName }) => toRow(review, businessName));
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A3:I`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }
}

/** 1件追記する（通知ハンドラ用） */
export async function appendReview(review: Review, businessName: string): Promise<void> {
  await appendReviews([{ review, businessName }]);
}
