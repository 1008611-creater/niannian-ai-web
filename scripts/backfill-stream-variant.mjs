import { execFileSync } from "node:child_process";

const taskId = process.argv[2];
if (!/^[A-Za-z0-9_-]{12,120}$/.test(taskId ?? "")) throw new Error("task ID is required");

const root = `/var/lib/docker/volumes/niannian-ai-video-workbench_niannian-data/_data/video-outputs/${taskId}`;
const remote = `
set -euo pipefail
root=${JSON.stringify(root)}
while IFS= read -r -d '' source; do
  target="\${source%.mp4}.stream.mp4"
  [ -f "\$target" ] && continue
  ffmpeg -nostdin -v error -y -i "\$source" -map 0:v:0 -map 0:a? -c:v libx264 -preset veryfast -b:v 900k -maxrate 1100k -bufsize 2200k -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart "\${target}.tmp.mp4"
  mv "\${target}.tmp.mp4" "\$target"
  setfacl -m u:www-data:rx "\$target"
done < <(find "\$root" -type f -name '*.mp4' ! -name '*.stream.mp4' ! -name '*.playback.mp4' -print0)
find "\$root" -type f -name '*.stream.mp4' -exec ffprobe -v error -show_entries format=size,bit_rate,duration -of json {} \\;
`;
process.stdout.write(execFileSync("ssh", ["tencent-niannian", "sudo bash -s --"], {
  encoding: "utf8",
  input: remote,
}));
