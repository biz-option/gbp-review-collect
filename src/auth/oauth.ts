import { OAuth2Client } from 'google-auth-library';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'oaky-gmb';
const secretClient = new SecretManagerServiceClient();

async function getSecret(secretName: string): Promise<string> {
  const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;
  const [version] = await secretClient.accessSecretVersion({ name });
  const payload = version.payload?.data;
  if (!payload) throw new Error(`Secret "${secretName}" が空です`);
  return payload.toString();
}

export async function getGbpAuthClient(): Promise<OAuth2Client> {
  const clientId = process.env.GBP_CLIENT_ID;
  const clientSecret = process.env.GBP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GBP_CLIENT_ID / GBP_CLIENT_SECRET が設定されていません');
  }

  const refreshToken = await getSecret('gbp-refresh-token');

  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export async function getGmailAuthClient(): Promise<OAuth2Client> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET が設定されていません');
  }

  const refreshToken = await getSecret('gmail-refresh-token');

  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
