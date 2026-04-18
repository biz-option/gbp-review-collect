/**
 * GBP Push Notification 登録スクリプト
 * 全アカウント・全ロケーションに対して通知設定を行う
 * Usage: npm run register-notifications
 */

import 'dotenv/config';
import axios from 'axios';
import { getGbpAuthClient } from '../src/auth/oauth';
import { listAccounts, NOTIFICATIONS_URL } from '../src/api/gbp';

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'oaky-gmb';
const PUBSUB_TOPIC = process.env.PUBSUB_TOPIC || 'gbp-review-notifications';

// Pub/Sub トピックの完全名
const TOPIC_NAME = `projects/${GCP_PROJECT_ID}/topics/${PUBSUB_TOPIC}`;

async function registerNotification(
  auth: ReturnType<typeof getGbpAuthClient> extends Promise<infer T> ? T : never,
  accountName: string
): Promise<void> {
  const token = await auth.getAccessToken();

  // 既存の設定を確認
  try {
    const existing = await axios.get(
      `${NOTIFICATIONS_URL}/${accountName}/notificationSetting`,
      { headers: { Authorization: `Bearer ${token.token}` } }
    );
    console.log(`  既存の通知設定: ${JSON.stringify(existing.data)}`);
  } catch {
    // 設定なし = 正常
  }

  // 通知設定を登録/更新
  await axios.patch(
    `${NOTIFICATIONS_URL}/${accountName}/notificationSetting`,
    {
      name: `${accountName}/notificationSetting`,
      pubsubTopic: TOPIC_NAME,
      notificationTypes: ['NEW_REVIEW', 'UPDATED_REVIEW'],
    },
    {
      params: { updateMask: 'pubsubTopic,notificationTypes' },
      headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    }
  );

  console.log(`  ✓ 通知登録完了: ${accountName} → ${TOPIC_NAME}`);
}

async function main() {
  console.log('=== GBP Push Notification 登録 ===\n');
  console.log(`Pub/Sub トピック: ${TOPIC_NAME}\n`);

  const auth = await getGbpAuthClient();
  const accounts = await listAccounts(auth);

  if (accounts.length === 0) {
    console.error('アカウントが見つかりません。GBP APIのアクセス権限を確認してください。');
    process.exit(1);
  }

  console.log(`アカウント数: ${accounts.length}`);

  for (const account of accounts) {
    console.log(`\nアカウント: ${account.accountName} (${account.name})`);

    try {
      await registerNotification(auth, account.name);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        console.error(`  ✗ エラー: ${err.response?.status} ${JSON.stringify(err.response?.data)}`);
      } else {
        console.error(`  ✗ エラー:`, err);
      }
    }
  }

  console.log('\n=== 登録完了 ===');
  console.log('注意: Pub/Sub トピックに Cloud Functions のサブスクリプションが設定されていることを確認してください。');
}

main().catch((err) => {
  if (axios.isAxiosError(err)) {
    console.error('エラー:', err.response?.status, JSON.stringify(err.response?.data, null, 2));
  } else {
    console.error('エラー:', err.message);
  }
  process.exit(1);
});
