// @ts-nocheck
import "express-session";

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
    user?: {
      username: string;
    };
  }
}

export {};
