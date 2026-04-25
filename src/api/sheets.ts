import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Review, starToNumber } from './gbp';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const SHEET_NAME = process.env.SHEET_NAME || 'レビュー一覧';

// シート列定義（A列から順）
// A: 取得日時, B: 投稿日時, C: ビジネス名, D: 評価（数字）, E: 評価（星）, F: 投稿者名, G: コメント, H: 返信
const HEADER_ROW = ['取得日時', '投稿日時', 'ビジネス名', '評価（数字）', '評価（星）', '投稿者名', 'コメント', '返信'];

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

export async function ensureSheetHeader(auth: OAuth2Client): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth });

  // 2行目にヘッダーがなければ書き込む（1行目は最終更新日時用）
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:H2`,
  });

  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] },
    });
  }
}

export async function updateLastFetchTime(auth: OAuth2Client): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth });
  const now = formatJst(new Date().toISOString());

  // A1セルに最終更新日時を記録（データとは別のメタ行）
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[`最終更新: ${now}`]] },
  });
}

export async function appendReview(
  auth: OAuth2Client,
  review: Review,
  businessName: string
): Promise<void> {
  const sheets = google.sheets({ version: 'v4', auth });

  const starNum = starToNumber(review.starRating);
  const fetchedAt = formatJst(new Date().toISOString());
  const postedAt = formatJst(review.createTime);
  const reviewer = review.reviewer.isAnonymous ? '匿名ユーザー' : review.reviewer.displayName;
  const comment = review.comment ?? '';
  const reply = review.reviewReply?.comment ?? '';

  const row = [
    fetchedAt,
    postedAt,
    businessName,
    starNum,
    toStars(starNum),
    reviewer,
    comment,
    reply,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A3:H`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}
