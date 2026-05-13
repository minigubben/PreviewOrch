import type {
  DeploymentMetadata,
  DeploymentRecord,
  DeploymentRuntime,
  GithubDeploymentState,
  RepoInput,
  RepoRecord,
  ScriptRunInput,
  ScriptRunResult,
  SshKeyStatus,
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

export interface GithubDeploymentApiRecord {
  id: number;
  statuses_url?: string;
}

export interface GithubDeploymentPublisherLike {
  isEnabled(): boolean;
  createDeployment(input: {
    owner: string;
    repo: string;
    ref: string;
    environment: string;
    description: string;
    payload?: unknown;
  }): Promise<GithubDeploymentApiRecord>;
  createDeploymentStatus(input: {
    owner: string;
    repo: string;
    deploymentId: number;
    state: GithubDeploymentState;
    environment: string;
    environmentUrl?: string;
    logUrl?: string;
    description: string;
    autoInactive: boolean;
  }): Promise<unknown>;
  buildLogUrl(deploymentId: string): string;
}

export interface LockManagerLike {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
}

export interface SshKeyManagerLike {
  getStatus(): Promise<SshKeyStatus>;
  generateOrRotate(): Promise<SshKeyStatus>;
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
