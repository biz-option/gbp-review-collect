import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';

const ACCOUNT_MGMT_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO_URL = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const NOTIFICATIONS_URL = 'https://mybusinessnotifications.googleapis.com/v1';
const REVIEWS_URL = 'https://mybusiness.googleapis.com/v4';

export interface Review {
  name: string;           // e.g. "accounts/xxx/locations/yyy/reviews/zzz"
  reviewId: string;
  reviewer: {
    displayName: string;
    isAnonymous: boolean;
  };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;     // ISO 8601
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

const STAR_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

export function starToNumber(rating: string): number {
  return STAR_MAP[rating] ?? 0;
}

const TRANSLATED_PREFIX = /^\s*[(（]\s*(?:Translated by Google|Google\s*による翻訳)\s*[)）]\s*/i;
const ORIGINAL_MARKER = /[(（]\s*(?:Original|原文)\s*[)）]\s*/i;

/**
 * Google 翻訳で付与された訳文を除き、投稿者の原文だけを返す。
 * 形式: "(Translated by Google) 訳文 \n\n(Original) 原文"。原文マーカーが無ければ接頭辞だけ除く。
 */
export function stripGoogleTranslation(text: string | undefined): string {
  if (!text) return '';
  if (!TRANSLATED_PREFIX.test(text)) return text;
  const m = ORIGINAL_MARKER.exec(text);
  return (m ? text.slice(m.index + m[0].length) : text.replace(TRANSLATED_PREFIX, '')).trim();
}

export async function getReview(
  auth: OAuth2Client,
  reviewName: string  // "accounts/{accountId}/locations/{locationId}/reviews/{reviewId}"
): Promise<Review> {
  const token = await auth.getAccessToken();
  const res = await axios.get(`${REVIEWS_URL}/${reviewName}`, {
    headers: { Authorization: `Bearer ${token.token}` },
  });
  return res.data as Review;
}

export async function listAccounts(auth: OAuth2Client): Promise<Array<{ name: string; accountName: string }>> {
  const all: Array<{ name: string; accountName: string }> = [];
  let pageToken: string | undefined;
  do {
    const token = await auth.getAccessToken();
    const res = await axios.get(`${ACCOUNT_MGMT_URL}/accounts`, {
      params: { pageSize: 20, pageToken },
      headers: { Authorization: `Bearer ${token.token}` },
    });
    all.push(...(res.data.accounts ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

export async function listLocations(
  auth: OAuth2Client,
  accountName: string, // "accounts/{accountId}"
  pageToken?: string
): Promise<{ locations: Array<{ name: string; title: string }>; nextPageToken?: string }> {
  const token = await auth.getAccessToken();
  const res = await axios.get(`${BUSINESS_INFO_URL}/${accountName}/locations`, {
    params: { readMask: 'name,title', pageSize: 100, pageToken },
    headers: { Authorization: `Bearer ${token.token}` },
  });
  const locations = (res.data.locations ?? []).map((loc: { name: string; title?: string }) => ({
    // loc.name = "locations/{id}" → construct full path for v4 API
    name: `${accountName}/${loc.name}`,
    title: loc.title ?? loc.name.split('/').pop() ?? loc.name,
  }));
  return { locations, nextPageToken: res.data.nextPageToken };
}

const MAX_PAGE_ATTEMPTS = 3;

/** 1ページ分のレビューを取得する。429/5xx/ネットワークエラーのみ、同じ pageToken で最大3回リトライする */
async function getReviewsPage(auth: OAuth2Client, locationName: string, pageToken?: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      const token = await auth.getAccessToken();
      return await axios.get(`${REVIEWS_URL}/${locationName}/reviews`, {
        params: { pageSize: 50, pageToken },
        headers: { Authorization: `Bearer ${token.token}` },
      });
    } catch (e) {
      const status = axios.isAxiosError(e) ? e.response?.status : undefined;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_PAGE_ATTEMPTS) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

export async function listReviews(
  auth: OAuth2Client,
  locationName: string // "accounts/{accountId}/locations/{locationId}"
): Promise<Review[]> {
  const all: Review[] = [];
  let pageToken: string | undefined;
  do {
    const res = await getReviewsPage(auth, locationName, pageToken);
    all.push(...(res.data.reviews ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return all;
}

export { NOTIFICATIONS_URL, REVIEWS_URL };
