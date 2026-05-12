export type SessionCookieSecure = boolean | "auto";

export type TargetType = "pr" | "branch";
export type WebhookMappedAction = "deploy" | "destroy" | null;
export type DeploymentStatus = "deploying" | "running" | "destroying" | "failed";
export type GithubDeploymentState = "pending" | "success" | "failure" | "inactive";
export type PrDeploymentAccess = "anyone" | "members" | "collaborators" | "contributors";

export interface ClientAssets {
  js: string[];
  css: string[];
}

export interface AppConfig {
  port: number;
  baseDomain: string;
  orchestratorPublicUrl: string;
  adminUsername: string;
  adminPasswordHash: string;
  sessionSecret: string;
  sessionCookieSecure: SessionCookieSecure;
  githubWebhookSecret: string;
  githubDeploymentsToken: string;
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
  cloneSshUrl: string;
  composePath: string;
  workingDirectory: string;
  publicService: string;
  publicPort: number;
  defaultBranch: string;
  appendProxySettings: boolean;
  previewHostEnvVarName: string;
  extraEnv: Record<string, string>;
  extraEnvText: string;
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
  sourceCloneSshUrl: string;
  status: DeploymentStatus;
  lastEvent: string;
  envFile?: string;
  logFile: string;
  publicPort: number;
  publicService: string;
  appendProxySettings: boolean;
  previewHostEnvVarName: string;
  extraEnv: Record<string, string>;
  githubDeployment: GithubDeploymentRecord | null;
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
  sourceCloneSshUrl?: string;
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
