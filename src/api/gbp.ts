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

export async function listReviews(
  auth: OAuth2Client,
  locationName: string // "accounts/{accountId}/locations/{locationId}"
): Promise<Review[]> {
  const token = await auth.getAccessToken();
  const res = await axios.get(`${REVIEWS_URL}/${locationName}/reviews`, {
    params: { pageSize: 10 },
    headers: { Authorization: `Bearer ${token.token}` },
  });
  return res.data.reviews ?? [];
}

export { NOTIFICATIONS_URL, REVIEWS_URL };
