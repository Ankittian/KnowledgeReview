export type Role = "employee" | "reviewer" | "admin";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  department: string | null;
  primaryModule: string | null;
  role: Role;
}

export interface Session {
  sessionId: string;
  user: SessionUser;
}
