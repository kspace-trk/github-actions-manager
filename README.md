# GitHub Actions Manager

複数のリポジトリにまたがってGitHub Actionsワークフローを一元管理するシステム。

## 概要

このリポジトリは以下を提供します：

- Reusable Workflows: 共通のワークフローロジックを一元管理
- テンプレート配布: 各リポジトリに呼び出し側YAMLを自動配布
- 設定管理: 対象リポジトリと適用するワークフローを一元管理

## ディレクトリ構造

```
.
├── .github/workflows/     # Reusable workflows（再利用可能なワークフロー）
├── templates/             # 各リポジトリに配布するYAMLテンプレート
├── config/                # 対象リポジトリの設定
│   └── repositories.yaml  # 管理対象リポジトリのリスト
├── scripts/               # 配布・同期スクリプト
└── README.md
```

## セットアップ

### 1. 対象リポジトリの設定

`config/repositories.yaml` に管理対象のリポジトリを定義します：

```yaml
repositories:
  - name: owner/repo1
    workflows:
      - ci
      - release
  - name: owner/repo2
    workflows:
      - ci
```

### 2. ワークフローテンプレートの配布

#### ローカルで実行

```bash
# GitHub Personal Access Token を環境変数に設定
export GITHUB_TOKEN=your_token_here

# 配布スクリプトを実行
npm run sync
```

### 3. シークレットの設定

管理対象リポジトリに `GEMINI_API_KEY` などのシークレットを一括設定できます。

```bash
# .env ファイルに設定するか、環境変数として設定
export GITHUB_TOKEN=your_token_here
export GEMINI_API_KEY=your_api_key_here

# シークレット設定スクリプトを実行
npm run set-secrets
```

**必要な権限:**
- GitHub Personal Access Token に `repo` 権限が必要
- 対象リポジトリへの `admin` 権限が必要

#### GitHub Actionsで実行

1. リポジトリシークレットに `GITHUB_TOKEN` を設定
   - Settings > Secrets and variables > Actions > New repository secret
   - 権限: `repo`, `workflow`

2. GitHub Actionsで手動実行
   - Actions タブ > "Sync Workflows" > "Run workflow"

## 使い方

### Reusable Workflowの追加

1. `.github/workflows/` に新しいワークフローを作成
2. `on: workflow_call:` を指定して再利用可能にする
3. 必要に応じて `templates/` に呼び出し側テンプレートを追加

### 新しいリポジトリの追加

1. `config/repositories.yaml` に追加
2. 配布スクリプトを実行

## 利用可能なワークフロー

### CI Workflow
基本的なCI/CDワークフロー（linting、テスト、ビルド）

```yaml
repositories:
  - name: owner/repo
    workflows:
      - ci
```

### Gemini Workflows
Google Gemini AIを使用したIssue/PRの自動トリアージとコード支援

#### gemini-dispatch
Issue/PRのコメントで `@gemini-cli` を呼び出すと、Geminiが自動的に対応します。

```yaml
repositories:
  - name: owner/repo
    workflows:
      - gemini-dispatch
```

**必要な設定:**
- Repository variables:
  - `GOOGLE_CLOUD_LOCATION`: GCPのリージョン（例: `us-central1`）
  - `GOOGLE_CLOUD_PROJECT`: GCPプロジェクトID
  - `SERVICE_ACCOUNT_EMAIL`: サービスアカウントのメールアドレス
  - `GCP_WIF_PROVIDER`: Workload Identity Providerのパス
  - `GEMINI_CLI_VERSION`: Gemini CLIのバージョン（例: `v0.1.0`）
  - `GEMINI_MODEL`: 使用するモデル（例: `gemini-2.0-flash-exp`）
- Repository secrets:
  - `GEMINI_API_KEY`: Gemini API Key（オプション）
  - `GOOGLE_API_KEY`: Google API Key（オプション）
  - `APP_PRIVATE_KEY`: GitHub App Private Key（オプション）

**オプション設定:**
- Repository variables:
  - `APP_ID`: GitHub AppのID（GitHub App認証を使う場合）
  - `GEMINI_DEBUG`: デバッグモードを有効化（`true`/`false`）
  - `GOOGLE_GENAI_USE_GCA`: Gemini Code Assistを使用（`true`/`false`）
  - `GOOGLE_GENAI_USE_VERTEXAI`: Vertex AIを使用（`true`/`false`）
  - `UPLOAD_ARTIFACTS`: アーティファクトをアップロード（`true`/`false`）

## 必要な権限

配布スクリプトを実行するには、以下の権限を持つGitHub Personal Access Tokenが必要です：

- `repo` (full control of private repositories)
- `workflow` (update GitHub Action workflows)
