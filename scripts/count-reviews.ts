/**
 * レビュー件数の確認スクリプト（読み取り専用）
 * 店舗ごとに「現行 listReviews の件数」「API の totalReviewCount」「全ページ辿った実数」を比較する
 * Usage: npm run count-reviews [出力JSONパス]
 */

import 'dotenv/config';
import axios from 'axios';
import { writeFileSync } from 'fs';
import { getGbpAuthClient } from '../src/auth/oauth';
import { listAccounts, listLocations, listReviews, REVIEWS_URL } from '../src/api/gbp';

async function main() {
  const outPath = process.argv[2];
  const auth = await getGbpAuthClient();
  const rows: Array<{ location: string; title: string; listReviews: number; apiTotal: number | null; fullScan: number }> = [];

  for (const account of await listAccounts(auth)) {
    let pageToken: string | undefined;
    do {
      const { locations, nextPageToken } = await listLocations(auth, account.name, pageToken);
      pageToken = nextPageToken;

      for (const loc of locations) {
        const current = (await listReviews(auth, loc.name)).length;

        // 正解値: 全ページを辿る
        let full = 0;
        let apiTotal: number | null = null;
        let token: string | undefined;
        do {
          const t = await auth.getAccessToken();
          const res = await axios.get(`${REVIEWS_URL}/${loc.name}/reviews`, {
            params: { pageSize: 50, pageToken: token },
            headers: { Authorization: `Bearer ${t.token}` },
          });
          full += (res.data.reviews ?? []).length;
          apiTotal = res.data.totalReviewCount ?? apiTotal;
          token = res.data.nextPageToken;
        } while (token);

        rows.push({ location: loc.name, title: loc.title, listReviews: current, apiTotal, fullScan: full });
      }
    } while (pageToken);
  }

  console.table(rows.map(r => ({ 店舗: r.title, listReviews: r.listReviews, apiTotal: r.apiTotal, 全ページ実数: r.fullScan })));
  const sum = (k: 'listReviews' | 'fullScan') => rows.reduce((s, r) => s + r[k], 0);
  console.log(`合計: listReviews=${sum('listReviews')} / 全ページ実数=${sum('fullScan')} / 店舗数=${rows.length}`);
  if (outPath) writeFileSync(outPath, JSON.stringify(rows, null, 2));
}

main().catch(e => { console.error(e?.response?.data ?? e); process.exit(1); });
