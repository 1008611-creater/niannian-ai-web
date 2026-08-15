export type AuthorityClass = "authoritative" | "candidate" | "diagnostic" | "rejected" | "history";
export type WorkflowStatus = "blocked" | "ready" | "in_progress" | "review" | "verified";
export type TeamRole = "owner" | "director" | "editor" | "reviewer";

export interface TeamMember {
  id: string;
  name: string;
  role: TeamRole;
  title: string;
  avatar: string;
  status: "online" | "away";
}

export interface ArtifactLedgerEntry {
  id: string;
  label: string;
  authority: AuthorityClass;
  version: number;
  ownerId: string;
  verifiedBy?: string;
}

export interface ReferenceConfirmation {
  firstFrameAssetIds: string[];
  uploadReferenceAssetIds: string[];
  supportAssetIds: string[];
  confirmed: boolean;
  confirmedBy?: string;
}

export interface VideoTaskSpec {
  schemaVersion: "1.0";
  projectId: string;
  shotId: string;
  provider: "seedance-2";
  promptArtifactId: string;
  references: ReferenceConfirmation;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16";
  submitAllowed: boolean;
  authorizationId?: string;
}

export interface WorkflowNode {
  id: "step01" | "step02" | "step04" | "step05" | "reference" | "seedance" | "qa";
  shortLabel: string;
  label: string;
  status: WorkflowStatus;
  ownerId: string;
  summary: string;
  artifactCount: number;
}

export interface SubmissionGate {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}
