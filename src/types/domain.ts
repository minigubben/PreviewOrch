export type SessionCookieSecure = boolean | "auto";
export type TrustProxySetting = boolean | number | string;

export type TargetType = "pr" | "branch" | "default-branch";
export type WebhookMappedAction = "deploy" | "destroy" | null;
export type DeploymentStatus = "deploying" | "running" | "destroying" | "failed";
export type GithubDeploymentState = "pending" | "success" | "failure" | "inactive";
export type PrDeploymentAccess = "anyone" | "members" | "collaborators" | "contributors";

export interface ClientAssets {
  js: string[];
  css: string[];
}

export interface GithubAppRepository {
  id: number | null;
  name: string;
  ownerLogin: string;
  fullName: string;
  private: boolean;
}

export interface GithubAppInstallation {
  id: number;
  accountLogin: string;
  targetType: string;
  repositorySelection: string;
  permissions: Record<string, string>;
  events: string[];
  htmlUrl: string;
  repositoriesUrl: string;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  repositories: GithubAppRepository[];
}

export interface GithubAppConfig {
  appId: number;
  clientId: string;
  clientSecret: string;
  privateKeyPem: string;
  webhookSecret: string;
  slug: string;
  name: string;
  ownerLogin: string;
  ownerType: string;
  createdAt: string;
  updatedAt: string;
  installations: GithubAppInstallation[];
}

export interface AppSettings {
  createdAt: string;
  updatedAt: string;
  baseDomain: string;
  orchestratorPublicUrl: string;
  traefikNetworkName: string;
  sourceOfTruth: string;
  githubApp: GithubAppConfig | null;
}

export interface GithubAppManifest {
  name: string;
  url: string;
  redirect_url: string;
  callback_urls: string[];
  description: string;
  public: boolean;
  default_events: string[];
  default_permissions: Record<string, string>;
  hook_attributes: {
    url: string;
    active: boolean;
  };
  request_oauth_on_install: boolean;
}

export interface GithubAppManifestConversion {
  id: number;
  client_id: string;
  client_secret: string;
  pem: string;
  webhook_secret: string;
  slug: string;
  name: string;
  owner?: {
    login?: string;
    type?: string;
  };
}

export interface GithubOAuthTokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
}

export interface GithubInstallationAccessTokenResponse {
  token: string;
  expires_at: string;
}

export interface GithubIssueComment {
  id: number;
  body: string;
}

export interface GithubAppInstallationApiRecord {
  id: number;
  account?: {
    login?: string;
  };
  target_type?: string;
  repository_selection?: string;
  permissions?: Record<string, string>;
  events?: string[];
  html_url?: string;
  repositories_url?: string;
  suspended_at?: string | null;
  created_at?: string;
  updated_at?: string;
  repositories?: Array<
    GithubAppRepositoryApiRecord & {
      fullName?: string;
      ownerLogin?: string;
    }
  >;
}

export interface GithubAppRepositoryApiRecord {
  id?: number;
  name?: string;
  full_name?: string;
  private?: boolean;
  owner?: {
    login?: string;
  };
}

export interface AppConfig {
  port: number;
  baseDomain: string;
  orchestratorPublicUrl: string;
  adminUsername: string;
  adminPasswordHash: string;
  sessionSecret: string;
  sessionCookieSecure: SessionCookieSecure;
  trustProxy: TrustProxySetting;
  githubApiBaseUrl: string;
  traefikNetworkName: string;
  nodeEnv: string;
  dataRoot: string;
  configDir: string;
  deploymentsDir: string;
  logsDir: string;
  sshDir: string;
  dockerSocketPath: string;
  reposFile: string;
  settingsFile: string;
  appLogFile: string;
  eventsLogFile: string;
  deploymentLogsDir: string;
  scripts: {
    validateRepo: string;
    deployPr: string;
    destroyPr: string;
    listManualTargets: string;
  };
}

export interface GithubRepoIdentity {
  owner: string;
  name: string;
}

export interface RepoRecord {
  id: string;
  owner: string;
  name: string;
  repository?: string;
  composePath: string;
  workingDirectory: string;
  publicService: string;
  publicPort: number;
  defaultBranch: string;
  githubInstallationId: number | null;
  appendProxySettings: boolean;
  extraEnv: Record<string, string>;
  extraEnvText: string;
  defaultBranchCustomHost: string;
  defaultBranchExtraEnv: Record<string, string>;
  defaultBranchExtraEnvText: string;
  prDeploymentAccess: PrDeploymentAccess;
  prDeploymentAllowedLogins: string[];
  prDeploymentAllowedLoginsText: string;
  enabled: boolean;
  slug: string;
  createdAt?: string;
  updatedAt?: string;
}

export type RepoInput = Partial<RepoRecord> & {
  extraEnv?: unknown;
  extraEnvText?: string;
};

export type StoredRepo = Partial<RepoRecord> & {
  extraEnv?: unknown;
};

export interface GithubDeploymentRecord {
  id: number;
  owner: string;
  repo: string;
  environment: string;
  ref: string;
  statusesUrl: string;
}

export interface DeploymentRuntimeContainer {
  id: string;
  name: string;
  service: string;
  state: string;
  networks: string[];
  labels: Record<string, string>;
  logTail: string;
}

export interface DeploymentRuntime {
  available: boolean;
  status: string;
  reason?: string;
  containers: DeploymentRuntimeContainer[];
  publicServiceContainer: DeploymentRuntimeContainer | null;
}

export interface DeploymentMetadata {
  deploymentId: string;
  deploymentKey: string;
  repoId: string;
  repoSlug: string;
  targetType: TargetType;
  targetValue: number | string | null;
  targetBranch: string | null;
  targetSha: string | null;
  prNumber: number | null;
  prBranch: string | null;
  prSha: string | null;
  previewHost: string;
  projectName: string;
  workDir: string;
  workingDirectory: string;
  projectDirectoryResolved: string;
  composePathResolved: string;
  proxyOverridePath?: string;
  status: DeploymentStatus;
  lastEvent: string;
  envFile?: string;
  logFile: string;
  publicPort: number;
  publicService: string;
  appendProxySettings: boolean;
  extraEnv: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface DeploymentRecord extends DeploymentMetadata {
  logTail?: string;
  runtime?: DeploymentRuntime;
}

export type DeploySeed = DeploymentMetadata;
export type DestroySeed = DeploymentMetadata;

export interface WebhookContext {
  action: string;
  mappedAction: WebhookMappedAction;
  installationId: number | null;
  repoFullName: string;
  repoOwner?: string;
  repoName?: string;
  prNumber: number;
  prBranch?: string;
  prSha?: string;
  prAuthorLogin?: string;
  prAuthorAssociation?: string;
  senderLogin?: string;
  headRepoFullName?: string;
  raw: unknown;
}

export interface ScriptRunResult<TParsed = unknown> {
  code: number | null;
  stdout: string;
  stderr: string;
  parsed: TParsed | null;
}

export interface ScriptRunInput {
  scriptPath: string;
  env?: Record<string, string>;
  logFile?: string | null;
  cwd?: string;
}

export interface SshKeyStatus {
  hasKey: boolean;
  algorithm: string | null;
  publicKey: string;
  publicKeyPath: string | null;
}
