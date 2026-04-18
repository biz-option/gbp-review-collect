/**
 * OAuth初回認証スクリプト
 * Usage:
 *   npm run auth:gbp    → GBP用リフレッシュトークン取得
 *   npm run auth:gmail  → Gmail用リフレッシュトークン取得
 */

import 'dotenv/config';
import { createServer } from 'http';
import { URL } from 'url';
import { OAuth2Client } from 'google-auth-library';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as readline from 'readline';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'oaky-gmb';

const SCOPES: Record<string, string[]> = {
  gbp: [
    'https://www.googleapis.com/auth/business.manage',
  ],
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
};

const SECRET_NAMES: Record<string, string> = {
  gbp: 'gbp-refresh-token',
  gmail: 'gmail-refresh-token',
};

async function getCredentialsFromUser(type: string): Promise<{ clientId: string; clientSecret: string }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

  console.log(`\n=== ${type.toUpperCase()} OAuth認証 ===`);
  console.log('GCPコンソール > APIとサービス > 認証情報 からOAuthクライアントIDを確認してください\n');

  const clientId = await ask('Client ID: ');
  const clientSecret = await ask('Client Secret: ');
  rl.close();

  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

async function saveToSecretManager(secretName: string, value: string): Promise<void> {
  const client = new SecretManagerServiceClient();
  const parent = `projects/${PROJECT_ID}`;
  const fullName = `${parent}/secrets/${secretName}`;

  // シークレットが存在するか確認、なければ作成
  try {
    await client.getSecret({ name: fullName });
    console.log(`シークレット "${secretName}" は既に存在します。新しいバージョンを追加します。`);
  } catch {
    console.log(`シークレット "${secretName}" を作成します...`);
    await client.createSecret({
      parent,
      secretId: secretName,
      secret: { replication: { automatic: {} } },
    });
  }

  // 新しいバージョンを追加
  await client.addSecretVersion({
    parent: fullName,
    payload: { data: Buffer.from(value, 'utf8') },
  });

  console.log(`✓ Secret Manager に保存しました: ${secretName}`);
}

async function runAuthFlow(type: string): Promise<void> {
  const { clientId, clientSecret } = await getCredentialsFromUser(type);

  const oauth2Client = new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: 'http://localhost:3000/callback',
  });

  const scopes = SCOPES[type];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // 毎回リフレッシュトークンを強制取得
  });

  console.log('\n以下のURLをブラウザで開いてください:');
  console.log(authUrl);
  console.log('\nローカルサーバーを起動中... (ポート 3000)');

  // 認証コードを受け取るローカルサーバー
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:3000');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`認証エラー: ${error}`);
        server.close();
        reject(new Error(`Auth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>認証完了！このタブを閉じてください。</h2>');
        server.close();
        resolve(code);
      }
    });

    server.listen(3000);
    server.on('error', reject);
  });

  console.log('\n認証コードを取得しました。トークンを交換中...');
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error('リフレッシュトークンが取得できませんでした。ブラウザでGoogleアカウントへのアクセスを一度取り消してから再実行してください。');
  }

  console.log(`✓ リフレッシュトークン取得成功`);

  // Secret Manager に保存
  await saveToSecretManager(SECRET_NAMES[type], tokens.refresh_token);

  console.log(`\n=== ${type.toUpperCase()} 認証完了 ===`);
}

async function main() {
  const type = process.argv[2];

  if (!type || !['gbp', 'gmail'].includes(type)) {
    console.error('Usage: ts-node scripts/auth-init.ts [gbp|gmail]');
    process.exit(1);
  }

  await runAuthFlow(type);
}

main().catch((err) => {
  console.error('エラー:', err.message);
  process.exit(1);
});
