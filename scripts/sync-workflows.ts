#!/usr/bin/env node

/**
 * GitHub Actions Manager - Workflow Sync Script
 *
 * このスクリプトは config/repositories.yaml で定義されたリポジトリに
 * templates/ 配下のワークフローテンプレートを配布します。
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GITHUB_API = 'https://api.github.com';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is not set');
  process.exit(1);
}

/**
 * GitHub API レスポンスの型定義
 */
interface GitHubFileResponse {
  content: string;
  sha: string;
}

/**
 * リポジトリ設定の型定義
 */
interface RepositoryConfig {
  name: string;
  workflows?: string[];
  branch?: string;
  runsOn?: string;
}

/**
 * 設定ファイルの型定義
 */
interface Config {
  repositories?: RepositoryConfig[];
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

  // 204 No Content や空のレスポンスの場合
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return {} as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

/**
 * ファイルの内容を Base64 エンコード
 */
function encodeBase64(content: string): string {
  return Buffer.from(content).toString('base64');
}

/**
 * リポジトリ内のファイルを取得または作成/更新
 */
async function syncFile(
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  branch = 'main'
): Promise<void> {
  const endpoint = `/repos/${owner}/${repo}/contents/${filePath}`;

  try {
    // 既存ファイルの取得
    const existing = await githubRequest<GitHubFileResponse>(
      endpoint + `?ref=${branch}`
    );

    // 内容が同じ場合はスキップ
    const existingContent = Buffer.from(existing.content, 'base64').toString('utf8');
    if (existingContent === content) {
      console.log(`  ✓ ${filePath} は既に最新です`);
      return;
    }

    // ファイルを更新
    await githubRequest(endpoint, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Update workflow: ${path.basename(filePath)}`,
        content: encodeBase64(content),
        sha: existing.sha,
        branch: branch,
      }),
    });

    console.log(`  ✓ ${filePath} を更新しました`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      // ファイルが存在しない場合は新規作成
      await githubRequest(endpoint, {
        method: 'PUT',
        body: JSON.stringify({
          message: `Add workflow: ${path.basename(filePath)}`,
          content: encodeBase64(content),
          branch: branch,
        }),
      });

      console.log(`  ✓ ${filePath} を作成しました`);
    } else {
      throw error;
    }
  }
}

/**
 * リポジトリ変数を設定
 */
async function setVariable(
  owner: string,
  repo: string,
  variableName: string,
  variableValue: string
): Promise<void> {
  const endpoint = `/repos/${owner}/${repo}/actions/variables/${variableName}`;

  try {
    // 既存の変数を取得
    await githubRequest(endpoint);

    // 変数が存在する場合は更新
    await githubRequest(endpoint, {
      method: 'PATCH',
      body: JSON.stringify({
        name: variableName,
        value: variableValue,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      // 変数が存在しない場合は新規作成
      await githubRequest(`/repos/${owner}/${repo}/actions/variables`, {
        method: 'POST',
        body: JSON.stringify({
          name: variableName,
          value: variableValue,
        }),
      });
    } else {
      throw error;
    }
  }
}

/**
 * ディレクトリ内のファイルを再帰的に取得
 */
async function getFilesRecursively(dir: string, fileList: string[] = []): Promise<string[]> {
  const files = await fs.readdir(dir, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await getFilesRecursively(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }

  return fileList;
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  console.log('GitHub Actions Manager - Workflow Sync\n');

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
    const branch = repoConfig.branch || 'main';

    console.log(`\n📦 ${repoConfig.name}`);

    // RUNS_ON 変数を設定
    if (repoConfig.runsOn) {
      try {
        await setVariable(owner, repo, 'RUNS_ON', repoConfig.runsOn);
        console.log(`  ✓ RUNS_ON 変数を設定しました: ${repoConfig.runsOn}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ RUNS_ON 変数の設定エラー:`, message);
      }
    }

    if (!repoConfig.workflows || repoConfig.workflows.length === 0) {
      console.log('  ⚠ ワークフローが定義されていません');
      continue;
    }

    // 各ワークフローテンプレートを配布
    for (const workflowName of repoConfig.workflows) {
      const templatePath = path.join(__dirname, `../templates/${workflowName}.yml`);

      try {
        const templateContent = await fs.readFile(templatePath, 'utf8');
        const targetPath = `.github/workflows/${workflowName}.yml`;

        await syncFile(owner, repo, targetPath, templateContent, branch);

        // .github/commands/ 配下のファイルも配布（存在する場合）
        const commandsDir = path.join(__dirname, `../templates/.github/commands`);
        try {
          const commandFiles = await getFilesRecursively(commandsDir);

          for (const commandFile of commandFiles) {
            const relativePath = path.relative(path.join(__dirname, '../templates'), commandFile);
            const commandContent = await fs.readFile(commandFile, 'utf8');
            await syncFile(owner, repo, relativePath, commandContent, branch);
          }
        } catch (error) {
          // .github/commands/ が存在しない場合は無視
          if (error instanceof Error && !error.message.includes('ENOENT')) {
            throw error;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ ${workflowName}.yml のエラー:`, message);
      }
    }
  }

  console.log('\n✅ 同期が完了しました');
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Error:', message);
  process.exit(1);
});
