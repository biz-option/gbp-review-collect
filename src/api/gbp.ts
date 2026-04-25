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
  const token = await auth.getAccessToken();
  const res = await axios.get(`${ACCOUNT_MGMT_URL}/accounts`, {
    headers: { Authorization: `Bearer ${token.token}` },
  });
  return res.data.accounts ?? [];
}

export async function listLocations(
  auth: OAuth2Client,
  accountName: string // "accounts/{accountId}"
): Promise<Array<{ name: string; title: string }>> {
  const token = await auth.getAccessToken();
  const res = await axios.get(`${BUSINESS_INFO_URL}/${accountName}/locations`, {
    params: { readMask: 'name,title' },
    headers: { Authorization: `Bearer ${token.token}` },
  });
  return res.data.locations ?? [];
}

export { NOTIFICATIONS_URL };
