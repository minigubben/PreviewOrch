export interface RepoValidationDetails {
  configureUrl?: string;
  [key: string]: unknown;
}

class RepoValidationError extends Error {
  details: RepoValidationDetails | null;

  constructor(message: string, details: RepoValidationDetails | null = null) {
    super(message);
    this.name = "RepoValidationError";
    this.details = details;
  }
}

export { RepoValidationError };
