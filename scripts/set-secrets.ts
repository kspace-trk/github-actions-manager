#!/usr/bin/env node

/**
 * GitHub Actions Manager - Set Secrets Script
 *
 * このスクリプトは config/repositories.yaml で定義されたリポジトリに
 * GEMINI_API_KEY などのシークレットを設定します。
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { seal } from 'tweetnacl-sealedbox-js';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GITHUB_API = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is not set');
  process.exit(1);
}

/**
 * リポジトリ設定の型定義
 */
interface RepositoryConfig {
  name: string;
  workflows?: string[];
  branch?: string;
}

/**
 * 設定ファイルの型定義
 */
interface Config {
  repositories?: RepositoryConfig[];
}

/**
 * GitHub API の公開鍵レスポンス
 */
interface PublicKeyResponse {
  key_id: string;
  key: string;
}

/**
 * GitHub API リクエストを実行
 */
async function githubRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${GITHUB_API}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${error}`);
  }

  // 204 No Content や空のレスポンスの場合は null を返す
  const contentType = response.headers.get('content-type');
  if (response.status === 204 || !contentType?.includes('application/json')) {
    return null as T;
  }

  // レスポンスボディが空の場合も考慮
  const text = await response.text();
  if (!text || text.length === 0) {
    return null as T;
  }

  return JSON.parse(text) as T;
}

/**
 * libsodium (tweetnacl) を使用してシークレット値を暗号化
 * GitHub の公開鍵を使用して sealed box 暗号化を行います
 */
function encryptSecret(publicKey: string, secretValue: string): string {
  // Base64 デコードして公開鍵のバイト配列を取得
  const publicKeyBytes = decodeBase64(publicKey);

  // UTF-8 エンコードしてシークレット値のバイト配列を取得
  const secretBytes = new TextEncoder().encode(secretValue);

  // sealed box で暗号化
  const encryptedBytes = seal(secretBytes, publicKeyBytes);

  // Base64 エンコードして返す
  return encodeBase64(encryptedBytes);
}

/**
 * リポジトリの公開鍵を取得
 */
async function getPublicKey(owner: string, repo: string): Promise<PublicKeyResponse> {
  return await githubRequest<PublicKeyResponse>(
    `/repos/${owner}/${repo}/actions/secrets/public-key`
  );
}

/**
 * リポジトリにシークレットを設定
 */
async function setSecret(
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string
): Promise<void> {
  // 公開鍵を取得
  const publicKey = await getPublicKey(owner, repo);

  // シークレット値を暗号化
  const encryptedValue = encryptSecret(publicKey.key, secretValue);

  // シークレットを設定
  await githubRequest(`/repos/${owner}/${repo}/actions/secrets/${secretName}`, {
    method: 'PUT',
    body: JSON.stringify({
      encrypted_value: encryptedValue,
      key_id: publicKey.key_id,
    }),
  });
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  console.log('GitHub Actions Manager - Set Secrets\n');

  // 設定ファイルの読み込み
  const configPath = path.join(__dirname, '../config/repositories.yaml');
  const configContent = await fs.readFile(configPath, 'utf8');
  const config = yaml.load(configContent) as Config;

  if (!config.repositories || config.repositories.length === 0) {
    console.log('設定ファイルに管理対象リポジトリが定義されていません。');
    return;
  }

  // 各リポジトリに対して処理
  for (const repoConfig of config.repositories) {
    const [owner, repo] = repoConfig.name.split('/');

    console.log(`\n📦 ${repoConfig.name}`);

    try {
      // GEMINI_API_KEY を設定
      await setSecret(owner, repo, 'GEMINI_API_KEY', GEMINI_API_KEY);
      console.log('  ✓ GEMINI_API_KEY を設定しました');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('  ✗ GEMINI_API_KEY の設定エラー:', message);
    }
  }

  console.log('\n✅ シークレットの設定が完了しました');
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Error:', message);
  process.exit(1);
});
