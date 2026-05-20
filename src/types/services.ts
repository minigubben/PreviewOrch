import type {
  DeploymentMetadata,
  DeploymentRecord,
  DeploymentRuntime,
  RepoInput,
  RepoRecord,
  ScriptRunInput,
  ScriptRunResult,
  WebhookContext,
} from "./domain.js";

export interface LoggerLike {
  info(message: string, context?: Record<string, unknown>): Promise<void>;
  warn(message: string, context?: Record<string, unknown>): Promise<void>;
  error(message: string, context?: Record<string, unknown>): Promise<void>;
}

export interface ScriptRunnerLike {
  run<TParsed = unknown>(input: ScriptRunInput): Promise<ScriptRunResult<TParsed>>;
  checkCommand(command: string, args?: string[]): Promise<boolean>;
}

export interface RepoStoreLike {
  list(): Promise<RepoRecord[]>;
  getById(id: string): Promise<RepoRecord | null>;
  findByFullName(fullName: string): Promise<RepoRecord | null>;
  create(input: RepoInput): Promise<RepoRecord>;
  update(id: string, input: RepoInput): Promise<RepoRecord>;
  updateInstallationId(id: string, githubInstallationId: number): Promise<RepoRecord | null>;
  remove(id: string): Promise<boolean>;
}

export interface DeploymentStoreLike {
  getWorkDir(repoSlug: string, deploymentKey: string): string;
  getMetadataPath(repoSlug: string, deploymentKey: string): string;
  getLogPath(repoSlug: string, deploymentKey: string): string;
  save(metadata: DeploymentMetadata): Promise<DeploymentMetadata>;
  getById(deploymentId: string): Promise<DeploymentMetadata | null>;
  list(): Promise<DeploymentMetadata[]>;
  listWithLogTails(maxLines?: number): Promise<DeploymentRecord[]>;
}

export interface RuntimeInspectorLike {
  inspectDeployment(deployment: DeploymentMetadata): Promise<DeploymentRuntime>;
}

export interface GithubAppStoreLike {
  syncEnvironment(config: unknown): Promise<void>;
  getGithubApp(): Promise<unknown>;
  saveGithubApp(input: unknown): Promise<unknown>;
  replaceInstallations(installations: unknown[]): Promise<unknown>;
}

export interface GithubAppClientLike {
  buildManifest(input: { orchestratorPublicUrl: string; appName: string }): Record<string, unknown>;
  convertManifestCode(code: string): Promise<Record<string, unknown>>;
  exchangeOAuthCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<Record<string, unknown>>;
  listUserInstallations(userAccessToken: string): Promise<Record<string, unknown>[]>;
  listAppInstallations(githubApp: unknown): Promise<Record<string, unknown>[]>;
  getRepoInstallation(githubApp: unknown, owner: string, repo: string): Promise<Record<string, unknown>>;
  createInstallationAccessToken(
    githubApp: unknown,
    installationId: number,
  ): Promise<Record<string, unknown>>;
  listInstallationRepositories(token: string): Promise<Record<string, unknown>[]>;
  listIssueComments(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
  }): Promise<Record<string, unknown>[]>;
  createIssueComment(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
    body: string;
  }): Promise<Record<string, unknown>>;
  updateIssueComment(input: {
    owner: string;
    repo: string;
    commentId: number;
    token: string;
    body: string;
  }): Promise<Record<string, unknown>>;
}

export interface LockManagerLike {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export interface GithubInstallationResolverLike {
  getGithubAppOrThrow(): Promise<unknown>;
  refreshInstallationsUsingApp(): Promise<unknown>;
  refreshInstallationsForUserToken(userToken: string): Promise<unknown>;
  resolveRepoAccess(
    repoLike: Pick<RepoRecord, "owner" | "name">,
    options?: { refresh?: boolean },
  ): Promise<{
    githubApp: unknown;
    installation: Record<string, unknown>;
    token: string;
    expiresAt?: string;
    repoUrl: string;
    repoFullName: string;
  }>;
}

export interface GithubPullRequestCommentPublisherLike {
  publish(
    repo: RepoRecord,
    metadata: DeploymentMetadata,
    input: { state: string; description: string },
  ): Promise<void>;
}

export interface DeploymentServiceLike {
  listDeployments(): Promise<DeploymentRecord[]>;
  handleWebhook(webhookContext: WebhookContext): Promise<Record<string, unknown>>;
  redeployById(deploymentId: string): Promise<DeploymentMetadata>;
  destroyById(deploymentId: string): Promise<Record<string, unknown>>;
  deployManualTarget(input: {
    repoId: string;
    manualTargetType: string;
    manualTargetValue: string;
  }): Promise<DeploymentMetadata>;
  listManualTargets(repoId: string): Promise<{
    defaultBranch: string;
    branches: string[];
    pullRequests: Array<{ number: number; label: string }>;
  }>;
}
