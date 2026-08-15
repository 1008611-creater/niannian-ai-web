import { execFileSync } from "node:child_process";

const taskId = process.argv[2];
if (!/^[A-Za-z0-9_-]{12,120}$/.test(taskId ?? "")) throw new Error("task ID is required");
const script = `
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const result = await pool.query('SELECT output_path FROM video_tasks WHERE id = $1 LIMIT 1', [${JSON.stringify(taskId)}]);
  if (!result.rows[0]?.output_path) process.exitCode = 2;
  else process.stdout.write(result.rows[0].output_path);
  await pool.end();
})().catch((error) => { console.error(error.message); process.exit(1); });
`;
process.stdout.write(execFileSync("ssh", ["tencent-niannian", "docker exec -i niannian-ai-video-workbench-app-1 node -"], {
  encoding: "utf8",
  input: script,
}));
