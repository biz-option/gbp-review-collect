import { google } from 'googleapis';
import { Review, starToNumber } from './gbp';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
const SHEET_NAME = process.env.SHEET_NAME || 'レビュー一覧';

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

export async function updateLastFetchTime(): Promise<void> {
  const sheets = getSheetsClient();
  const now = new Date();

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `${SHEET_NAME}!A1`, values: [[`最終更新: ${formatJst(now.toISOString())}`]] },
        { range: `${SHEET_NAME}!B1`, values: [[now.toISOString()]] },
      ],
    },
  });
}

export async function appendReview(
  review: Review,
  businessName: string
): Promise<void> {
  const sheets = getSheetsClient();

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
