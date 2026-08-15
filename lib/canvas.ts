import { dbOne, dbRun, timestamp } from "@/lib/auth";
import { CanvasDocument, emptyCanvasDocument, normalizeCanvasDocument } from "@/lib/canvas-contract";

type CanvasRow = {
  project_id: string;
  user_id: string;
  document_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export async function getCanvasDocument(userId: string, projectId: string) {
  const row = await dbOne<CanvasRow>(
    "SELECT * FROM canvas_documents WHERE project_id = ? AND user_id = ? LIMIT 1",
    [projectId, userId],
  );
  if (!row) return { document: emptyCanvasDocument(projectId), revision: 0, updatedAt: null };
  try {
    return { document: normalizeCanvasDocument(JSON.parse(row.document_json), projectId), revision: Number(row.revision) || 0, updatedAt: row.updated_at };
  } catch {
    return { document: emptyCanvasDocument(projectId), revision: Number(row.revision) || 0, updatedAt: row.updated_at };
  }
}

export async function saveCanvasDocument(userId: string, projectId: string, value: unknown, expectedRevision: number) {
  const current = await dbOne<CanvasRow>(
    "SELECT * FROM canvas_documents WHERE project_id = ? AND user_id = ? LIMIT 1",
    [projectId, userId],
  );
  const currentRevision = current ? Number(current.revision) || 0 : 0;
  if (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision) {
    throw new Error("CANVAS_REVISION_CONFLICT");
  }
  const document: CanvasDocument = normalizeCanvasDocument(value, projectId);
  const updatedAt = timestamp();
  const nextRevision = currentRevision + 1;
  if (current) {
    await dbRun(
      "UPDATE canvas_documents SET document_json = ?, revision = ?, updated_at = ? WHERE project_id = ? AND user_id = ? AND revision = ?",
      [JSON.stringify(document), nextRevision, updatedAt, projectId, userId, currentRevision],
    );
  } else {
    await dbRun(
      "INSERT INTO canvas_documents (project_id, user_id, document_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [projectId, userId, JSON.stringify(document), nextRevision, updatedAt, updatedAt],
    );
  }
  return { document, revision: nextRevision, updatedAt };
}
