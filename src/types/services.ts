import type {
  AppConfig,
  DeploymentMetadata,
  DeploymentRecord,
  DeploymentRuntime,
  GithubAppConfig,
  GithubAppInstallation,
  GithubAppInstallationApiRecord,
  GithubAppManifest,
  GithubAppManifestConversion,
  GithubAppRepositoryApiRecord,
  GithubInstallationAccessTokenResponse,
  GithubIssueComment,
  GithubOAuthTokenResponse,
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
  syncEnvironment(config: AppConfig): Promise<void>;
  getGithubApp(): Promise<GithubAppConfig | null>;
  saveGithubApp(input: Partial<GithubAppConfig>): Promise<GithubAppConfig>;
  replaceInstallations(installations: GithubAppInstallation[]): Promise<GithubAppConfig | null>;
}

export interface GithubAppClientLike {
  buildManifest(input: { orchestratorPublicUrl: string; appName: string }): GithubAppManifest;
  convertManifestCode(code: string): Promise<GithubAppManifestConversion>;
  exchangeOAuthCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<GithubOAuthTokenResponse>;
  listUserInstallations(userAccessToken: string): Promise<GithubAppInstallationApiRecord[]>;
  listAppInstallations(githubApp: GithubAppConfig): Promise<GithubAppInstallationApiRecord[]>;
  getRepoInstallation(
    githubApp: GithubAppConfig,
    owner: string,
    repo: string,
  ): Promise<GithubAppInstallationApiRecord>;
  createInstallationAccessToken(
    githubApp: GithubAppConfig,
    installationId: number,
  ): Promise<GithubInstallationAccessTokenResponse>;
  listInstallationRepositories(token: string): Promise<GithubAppRepositoryApiRecord[]>;
  listIssueComments(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
  }): Promise<GithubIssueComment[]>;
  createIssueComment(input: {
    owner: string;
    repo: string;
    issueNumber: number;
    token: string;
    body: string;
  }): Promise<GithubIssueComment>;
  updateIssueComment(input: {
    owner: string;
    repo: string;
    commentId: number;
    token: string;
    body: string;
  }): Promise<GithubIssueComment>;
}

export interface LockManagerLike {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export interface GithubInstallationResolverLike {
  getGithubAppOrThrow(): Promise<GithubAppConfig>;
  refreshInstallationsUsingApp(): Promise<GithubAppConfig>;
  refreshInstallationsForUserToken(userToken: string): Promise<GithubAppConfig>;
  resolveRepoAccess(
    repoLike: Pick<RepoRecord, "owner" | "name">,
    options?: { refresh?: boolean },
  ): Promise<{
    githubApp: GithubAppConfig | null;
    installation: GithubAppInstallation | null;
    token: string;
    expiresAt: string;
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
