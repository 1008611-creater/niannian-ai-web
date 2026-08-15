import { createId, dbAll, dbOne, dbRun, timestamp } from "@/lib/auth";
import { getProject, type ProjectRecord } from "@/lib/projects";
import type { VideoTaskRecord } from "@/lib/video-tasks";

export type ProjectAsset = {
  id: string;
  name: string;
  role: string;
  mimeType: string;
  byteSize: number;
  hidden: boolean;
  previewUrl: string;
  createdAt: string;
};

export type ScriptWorkflowRequest = {
  id: string;
  project_id: string;
  source_text: string;
  requirements: string;
  canonical_project_id: string | null;
  status: string;
  blocker: string | null;
  created_at: string;
  updated_at: string;
};

export async function ownedProject(userId: string, projectId: string) {
  const project = await getProject(userId, projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  return project;
}

export async function linkProjectAsset(userId: string, projectId: string, assetId: string) {
  await ownedProject(userId, projectId);
  const asset = await dbOne<{ id: string }>("SELECT id FROM uploaded_assets WHERE id = ? AND user_id = ? LIMIT 1", [assetId, userId]);
  if (!asset) throw new Error("ASSET_NOT_FOUND");
  await dbRun("INSERT INTO project_assets (project_id, asset_id, created_at) VALUES (?, ?, ?) ON CONFLICT (project_id, asset_id) DO NOTHING", [projectId, assetId, timestamp()]);
  return assetId;
}

export async function listProjectAssets(userId: string, projectId: string) {
  await ownedProject(userId, projectId);
  const rows = await dbAll<{
    id: string;
    original_name: string;
    role: string;
    mime_type: string;
    byte_size: number;
    hidden: number;
    created_at: string;
  }>(
    `SELECT uploaded_assets.id, uploaded_assets.original_name, uploaded_assets.role,
            uploaded_assets.mime_type, uploaded_assets.byte_size,
            COALESCE(asset_library_visibility.hidden, 0) AS hidden,
            uploaded_assets.created_at
       FROM project_assets
       JOIN uploaded_assets ON uploaded_assets.id = project_assets.asset_id
       LEFT JOIN asset_library_visibility ON asset_library_visibility.asset_id = uploaded_assets.id
      WHERE project_assets.project_id = ? AND uploaded_assets.user_id = ?
      ORDER BY project_assets.created_at DESC`,
    [projectId, userId],
  );
  return rows.map((row): ProjectAsset => ({
    id: row.id,
    name: row.original_name,
    role: row.role,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size) || 0,
    hidden: Boolean(Number(row.hidden)),
    previewUrl: `/api/assets?id=${encodeURIComponent(row.id)}`,
    createdAt: row.created_at,
  }));
}

export async function linkProjectTask(userId: string, projectId: string, taskId: string) {
  await ownedProject(userId, projectId);
  const task = await dbOne<{ id: string }>("SELECT id FROM video_tasks WHERE id = ? AND user_id = ? LIMIT 1", [taskId, userId]);
  if (!task) throw new Error("VIDEO_TASK_NOT_FOUND");
  await dbRun("INSERT INTO project_task_links (project_id, task_id, created_at) VALUES (?, ?, ?) ON CONFLICT (project_id, task_id) DO NOTHING", [projectId, taskId, timestamp()]);
  return taskId;
}

export async function listProjectVideoTasks(userId: string, projectId: string) {
  await ownedProject(userId, projectId);
  return dbAll<VideoTaskRecord>(
    `SELECT video_tasks.*
       FROM project_task_links
       JOIN video_tasks ON video_tasks.id = project_task_links.task_id
      WHERE project_task_links.project_id = ? AND video_tasks.user_id = ?
      ORDER BY project_task_links.created_at DESC`,
    [projectId, userId],
  );
}

export async function createScriptWorkflowRequest(input: {
  userId: string;
  projectId: string;
  sourceText: string;
  requirements: string;
}) {
  await ownedProject(input.userId, input.projectId);
  const sourceText = input.sourceText.trim().slice(0, 120000);
  const requirements = input.requirements.trim().slice(0, 4000);
  if (sourceText.length < 1) throw new Error("SCRIPT_SOURCE_REQUIRED");
  const now = timestamp();
  const request: ScriptWorkflowRequest = {
    id: createId(),
    project_id: input.projectId,
    source_text: sourceText,
    requirements,
    canonical_project_id: null,
    status: "awaiting_production_dispatch",
    blocker: null,
    created_at: now,
    updated_at: now,
  };
  await dbRun(
    `INSERT INTO script_workflow_requests
      (id, project_id, user_id, source_text, requirements, canonical_project_id, status, blocker, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [request.id, request.project_id, input.userId, request.source_text, request.requirements, null, request.status, null, now, now],
  );
  return request;
}

export async function listScriptWorkflowRequests(userId: string, projectId: string) {
  await ownedProject(userId, projectId);
  return dbAll<ScriptWorkflowRequest>(
    `SELECT id, project_id, source_text, requirements, canonical_project_id, status, blocker, created_at, updated_at
       FROM script_workflow_requests
      WHERE project_id = ? AND user_id = ?
      ORDER BY updated_at DESC`,
    [projectId, userId],
  );
}

function publicTask(task: VideoTaskRecord) {
  return {
    id: task.id,
    status: task.status,
    prompt: task.prompt,
    resolution: task.resolution,
    durationSeconds: Number(task.duration_seconds) || 0,
    aspectRatio: task.aspect_ratio,
    outputReady: Boolean(task.output_path) && task.status === "completed",
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

export async function projectOverview(userId: string, projectId: string) {
  const project = await ownedProject(userId, projectId);
  const [assets, tasks, scripts] = await Promise.all([
    listProjectAssets(userId, projectId),
    listProjectVideoTasks(userId, projectId),
    listScriptWorkflowRequests(userId, projectId),
  ]);
  return {
    project,
    modes: ["canvas", "redraw", "short_drama"],
    assets,
    tasks: tasks.map(publicTask),
    scripts: scripts.map((item) => ({
      id: item.id,
      status: item.status,
      requirements: item.requirements,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
    deliveries: tasks.filter((task) => task.status === "completed" && task.output_path).map(publicTask),
  };
}

export function publicProject(project: ProjectRecord) {
  return {
    id: project.id,
    title: project.title,
    type: project.type,
    status: project.status,
    progress: project.progress,
    episodes: project.episodes,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}
