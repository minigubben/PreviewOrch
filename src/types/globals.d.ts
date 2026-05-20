import "express-session";

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
    user?: {
      username: string;
    };
    githubAppManifestState?: string | null;
    githubAppManifestOwnerType?: string | null;
    githubAppOAuthStates?: string[];
  }
}

export {};
