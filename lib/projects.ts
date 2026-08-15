import { createId, dbAll, dbOne, dbRun, timestamp } from "@/lib/auth";

export const projectTypes = ["真人短剧", "动态漫", "广告片"] as const;
export type ProjectType = (typeof projectTypes)[number];

export type ProjectRecord = {
  id: string;
  user_id: string;
  title: string;
  type: ProjectType;
  progress: number;
  status: string;
  episodes: number;
  created_at: string;
  updated_at: string;
};

export function validProjectTitle(value: unknown) {
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ");
  return title.length >= 1 && title.length <= 60 ? title : null;
}

export function validProjectType(value: unknown): ProjectType | null {
  return typeof value === "string" && projectTypes.includes(value as ProjectType)
    ? (value as ProjectType)
    : null;
}

export async function listProjects(userId: string) {
  return dbAll<ProjectRecord>(
    "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
    [userId],
  );
}

export async function getProject(userId: string, projectId: string) {
  return dbOne<ProjectRecord>(
    "SELECT * FROM projects WHERE id = ? AND user_id = ? LIMIT 1",
    [projectId, userId],
  );
}

export async function createProject(userId: string, title: string, type: ProjectType) {
  const createdAt = timestamp();
  const project: ProjectRecord = {
    id: createId(),
    user_id: userId,
    title,
    type,
    progress: 0,
    status: "准备中",
    episodes: 1,
    created_at: createdAt,
    updated_at: createdAt,
  };
  await dbRun(
    "INSERT INTO projects (id, user_id, title, type, progress, status, episodes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [project.id, project.user_id, project.title, project.type, project.progress, project.status, project.episodes, project.created_at, project.updated_at],
  );
  return project;
}

export async function deleteProject(userId: string, projectId: string) {
  const existing = await getProject(userId, projectId);
  if (!existing) return false;
  await dbRun("DELETE FROM projects WHERE id = ? AND user_id = ?", [projectId, userId]);
  return true;
}
