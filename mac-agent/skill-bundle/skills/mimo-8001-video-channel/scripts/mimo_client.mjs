#!/usr/bin/env node

import { createWriteStream, promises as fs, openAsBlob } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const STATUS_TEXT = {
  1: 'completed',
  20: 'generating',
  40: 'failed',
  50: 'queued',
  60: 'generating',
};

function parseArgs(argv) {
  const args = {
    base: 'https://fd.aancn.cn',
    images: [],
    videos: [],
    audios: [],
    duration: 15,
    aspectRatio: '9:16',
    intervalMs: 10000,
    timeoutMs: 45 * 60 * 1000,
    uploadStrategy: process.env.MIMO_UPLOAD_STRATEGY || 'official_frontend',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      i += 1;
      return argv[i];
    };
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--base') args.base = next();
    else if (a === '--token') args.token = next();
    else if (a === '--token-env') args.tokenEnv = next();
    else if (a === '--username') args.username = next();
    else if (a === '--password') args.password = next();
    else if (a === '--username-env') args.usernameEnv = next();
    else if (a === '--password-env') args.passwordEnv = next();
    else if (a === '--prompt') args.prompt = next();
    else if (a === '--prompt-file') args.promptFile = next();
    else if (a === '--image') args.images.push(next());
    else if (a === '--video') args.videos.push(next());
    else if (a === '--audio') args.audios.push(next());
    else if (a === '--duration') args.duration = Number(next());
    else if (a === '--aspect-ratio' || a === '--aspectRatio') args.aspectRatio = next();
    else if (a === '--task-id') args.taskId = next();
    else if (a === '--out') args.out = next();
    else if (a === '--manifest') args.manifest = next();
    else if (a === '--submission-receipt') args.submissionReceipt = next();
    else if (a === '--poll-once') args.pollOnce = true;
    else if (a === '--upload-only') args.uploadOnly = true;
    else if (a === '--submit-only') args.submitOnly = true;
    else if (a === '--no-download') args.noDownload = true;
    else if (a === '--interval-ms') args.intervalMs = Number(next());
    else if (a === '--timeout-ms') args.timeoutMs = Number(next());
    else if (a === '--upload-strategy') args.uploadStrategy = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function usage() {
  return `Mimo/NAS 8001 direct video client

Examples:
  node mimo_client.mjs --token-env MIMO_TOKEN --image shot.jpg --prompt-file prompt.txt --duration 15 --aspect-ratio 9:16 --out clip.mp4 --manifest clip_manifest.json
  node mimo_client.mjs --username-env MIMO_USERNAME --password-env MIMO_PASSWORD --upload-strategy official_frontend --image shot.jpg --prompt-file prompt.txt --duration 15 --aspect-ratio 9:16 --out clip.mp4
  node mimo_client.mjs --username-env MIMO_USERNAME --password-env MIMO_PASSWORD --upload-only --image shot.jpg --manifest upload_manifest.json
  node mimo_client.mjs --username-env MIMO_USERNAME --password-env MIMO_PASSWORD --image shot.jpg --prompt-file prompt.txt --submission-receipt submitted.json --poll-once --no-download
  node mimo_client.mjs --username-env MIMO_USERNAME --password-env MIMO_PASSWORD --image shot.jpg --prompt-file prompt.txt --submission-receipt submitted.json --submit-only

Never pass literal secrets unless the user explicitly approves. Prefer *_ENV flags.`;
}

function envValue(name) {
  return name ? process.env[name] : '';
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readPrompt(args) {
  if (args.promptFile) return (await fs.readFile(args.promptFile, 'utf8')).trim();
  if (args.prompt) return args.prompt.trim();
  return '';
}

async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

async function apiJson(base, endpoint, { method = 'GET', token = '', body } = {}) {
  const headers = { ...authHeaders(token) };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(new URL(endpoint, base), { method, headers, body: payload });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${endpoint}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok || (data.code !== undefined && data.code !== 200 && data.code !== 0)) {
    const msg = data.msg || `HTTP ${res.status}`;
    throw new Error(`${endpoint} failed: ${msg}`);
  }
  return data;
}

async function login(args) {
  const token = args.token || envValue(args.tokenEnv);
  if (token) return { token, login: 'token' };
  const username = args.username || envValue(args.usernameEnv);
  const password = args.password || envValue(args.passwordEnv);
  if (!username || !password) {
    throw new Error('Auth required: provide --token-env MIMO_TOKEN or username/password env flags.');
  }
  const r = await apiJson(args.base, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  const data = r.data || {};
  if (!data.token) throw new Error('/api/auth/login did not return a token');
  return {
    token: data.token,
    login: 'username_password',
    username: data.username || username,
    credits: data.credits,
    isAdmin: data.isAdmin,
  };
}

async function uploadFile(args, token, filePath) {
  const abs = path.resolve(filePath);
  if (args.uploadStrategy === 'official_frontend' && isImagePath(abs)) return uploadOfficialFrontendImage(args, token, abs);
  if (!['official_frontend', 'legacy_api'].includes(args.uploadStrategy)) throw new Error(`Unsupported upload strategy: ${args.uploadStrategy}`);
  const blob = await openAsBlob(abs);
  const fd = new FormData();
  fd.append('file', blob, path.basename(abs));
  const res = await fetch(new URL('/api/video/upload', args.base), {
    method: 'POST',
    headers: authHeaders(token),
    body: fd,
  });
  const data = await res.json();
  if (!res.ok || data.code !== 200) throw new Error(`/api/video/upload failed for ${abs}: ${data.msg || res.status}`);
  const item = data.data || {};
  return {
    path: abs,
    sha256: await sha256(abs),
    response: item,
    uploadStrategy: 'legacy_api',
  };
}

function isImagePath(filePath) {
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(path.extname(filePath).toLowerCase());
}

async function officialUploadRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* Object storage does not always return JSON. */ }
  return { response, data };
}

async function uploadOfficialFrontendImage(args, token, abs) {
  const bytes = await fs.readFile(abs);
  const apply = await apiJson(args.base, '/api/video/upload-apply', {
    method: 'POST',
    token,
    body: { fileName: path.basename(abs), fileSize: bytes.length },
  });
  const ticket = apply.data || {};
  if (!ticket.uploadUrl || !ticket.sessionKey || !ticket.storeUri || !ticket.fileType) throw new Error('Official frontend upload ticket is incomplete.');
  const signedHeaders = ticket.uploadHeaders && typeof ticket.uploadHeaders === 'object' ? ticket.uploadHeaders : {};
  const init = await officialUploadRequest(`${ticket.uploadUrl}?uploadmode=part&phase=init`, { method: 'POST', headers: signedHeaders });
  const uploadId = init.data.uploadId || init.data?.data?.uploadId || '';
  if (uploadId) {
    const part = await officialUploadRequest(`${ticket.uploadUrl}?uploadmode=part&phase=upload&partnum=1&uploadid=${encodeURIComponent(uploadId)}`, {
      method: 'POST', headers: signedHeaders, body: bytes,
    });
    const etag = part.data.etag || part.data?.data?.etag || '0';
    const finish = await fetch(`${ticket.uploadUrl}?uploadmode=part&phase=finish&uploadid=${encodeURIComponent(uploadId)}`, {
      method: 'POST', headers: { ...signedHeaders, 'content-type': 'text/plain;charset=UTF-8' }, body: `1:${etag}`,
    });
    if (!finish.ok) throw new Error(`Official frontend multipart upload failed: HTTP ${finish.status}`);
  } else {
    const direct = await fetch(ticket.uploadUrl, { method: 'POST', headers: signedHeaders, body: bytes });
    if (!direct.ok) throw new Error(`Official frontend direct upload failed: HTTP ${direct.status}`);
  }
  const committed = await apiJson(args.base, '/api/video/upload-commit', {
    method: 'POST', token,
    body: { fileType: ticket.fileType, sessionKey: ticket.sessionKey, storeUri: ticket.storeUri, vid: ticket.vid || undefined },
  });
  const item = committed.data || {};
  if (!item.imageUri || !item.imageUrl) throw new Error('Official frontend image commit is missing imageUri or imageUrl.');
  return {
    path: abs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    response: item,
    uploadStrategy: 'official_frontend',
  };
}

function splitMaterials(uploaded) {
  const images = [];
  const videos = [];
  const audio = [];
  for (const u of uploaded) {
    const r = u.response || {};
    const ext = path.extname(u.path).toLowerCase();
    const isAudio = ['.mp3', '.wav', '.wma', '.aac', '.flac', '.ogg', '.m4a'].includes(ext);
    if (isAudio) {
      if (!r.vid) throw new Error(`Audio upload missing vid for ${u.path}`);
      audio.push({ audioVid: r.vid });
    }
    else if (r.vid && !r.imageUri) videos.push({ vid: r.vid });
    else images.push({ imageUri: r.imageUri, imageUrl: r.imageUrl });
  }
  return { images, videos, audio };
}

async function submitGenerate(args, token, prompt, uploaded) {
  if (!prompt) throw new Error('Prompt required for new generation.');
  const materials = splitMaterials(uploaded);
  const body = {
    prompt,
    duration: args.duration,
    aspectRatio: args.aspectRatio,
  };
  if (materials.images.length) body.images = materials.images;
  if (materials.videos.length) body.videos = materials.videos;
  if (materials.audio.length) body.audio = materials.audio;
  const r = await apiJson(args.base, '/api/video/generate', { method: 'POST', token, body });
  const taskId = r.data?.id;
  if (!taskId) throw new Error('/api/video/generate did not return data.id');
  return { taskId, request: body, response: r.data };
}

async function pollStatus(args, token, taskId) {
  const started = Date.now();
  while (true) {
    const r = await apiJson(args.base, '/api/video/batch-status', {
      method: 'POST',
      token,
      body: { taskIds: [taskId] },
    });
    const item = Array.isArray(r.data) ? r.data.find((x) => x.taskId === taskId) || r.data[0] : r.data;
    if (!item) throw new Error(`No status returned for task ${taskId}`);
    const status = Number(item.status);
    console.log(`task=${taskId} status=${status} ${STATUS_TEXT[status] || 'unknown'}`);
    if (args.pollOnce || status === 1 || status === 40) return item;
    if (Date.now() - started > args.timeoutMs) throw new Error(`Timed out waiting for task ${taskId}`);
    await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
  }
}

async function downloadVideo(args, token, videoUrl, outPath) {
  if (!videoUrl) throw new Error('Missing videoUrl for download');
  let url = videoUrl;
  if (!url.includes('tos-cn-beijing')) {
    const r = await apiJson(args.base, '/api/video/proxy-token', {
      method: 'POST',
      token,
      body: { url },
    });
    const proxyToken = r.data?.token;
    if (!proxyToken) throw new Error('/api/video/proxy-token did not return data.token');
    url = new URL(`/api/video/proxy-video?token=${encodeURIComponent(proxyToken)}`, args.base).toString();
  }
  await fs.mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  const res = await fetch(url, { headers: url.startsWith(args.base) ? authHeaders(token) : {} });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(outPath));
  return { path: path.resolve(outPath), sha256: await sha256(outPath) };
}

async function writeManifest(filePath, data) {
  if (!filePath) return;
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const auth = await login(args);
  const token = auth.token;
  const prompt = await readPrompt(args);
  const files = [...args.images, ...args.videos, ...args.audios];
  const uploaded = [];
  for (const f of files) uploaded.push(await uploadFile(args, token, f));
  if (args.uploadOnly) {
    await writeManifest(args.manifest, {
      base: args.base,
      auth: { mode: auth.login, username: auth.username || null, credits: auth.credits ?? null, token_present: true },
      uploadOnly: true,
      uploadStrategy: args.uploadStrategy,
      uploaded,
      createdAt: new Date().toISOString(),
    });
    console.log(`uploaded ${uploaded.length} material(s) without creating a video task`);
    return;
  }
  let taskId = args.taskId;
  let submitted = null;
  if (!taskId) {
    submitted = await submitGenerate(args, token, prompt, uploaded);
    taskId = submitted.taskId;
    // Persist the provider identifier before polling. A later polling/network failure
    // must never make an authorized parent worker submit the same task a second time.
    await writeManifest(args.submissionReceipt, {
      provider: 'mimo',
      providerTaskId: taskId,
      auth: { mode: auth.login, username: auth.username || null, credits: auth.credits ?? null, token_present: true },
      prompt_sha256: args.promptFile ? await sha256(args.promptFile) : null,
      duration: args.duration,
      aspectRatio: args.aspectRatio,
      uploadStrategy: args.uploadStrategy,
      uploaded,
      submittedAt: new Date().toISOString(),
    });
    console.log(`submitted task=${taskId}`);
  }
  if (args.submitOnly) {
    if (!submitted) throw new Error('--submit-only requires a new generation submission');
    await writeManifest(args.manifest, {
      base: args.base,
      auth: { mode: auth.login, username: auth.username || null, credits: auth.credits ?? null, token_present: true },
      prompt_sha256: args.promptFile ? await sha256(args.promptFile) : null,
      duration: args.duration,
      aspectRatio: args.aspectRatio,
      uploaded,
      uploadStrategy: args.uploadStrategy,
      submitted,
      finalStatus: null,
      downloaded: null,
      createdAt: new Date().toISOString(),
    });
    return;
  }
  const status = await pollStatus(args, token, taskId);
  const manifest = {
    base: args.base,
    auth: { mode: auth.login, username: auth.username || null, credits: auth.credits ?? null, token_present: true },
    prompt_sha256: args.promptFile ? await sha256(args.promptFile) : null,
    duration: args.duration,
    aspectRatio: args.aspectRatio,
    uploaded,
    uploadStrategy: args.uploadStrategy,
    submitted,
    finalStatus: status,
    downloaded: null,
    createdAt: new Date().toISOString(),
  };
  if (status.status === 1 && !args.noDownload) {
    if (!args.out) throw new Error('Completed task needs --out unless --no-download is set');
    manifest.downloaded = await downloadVideo(args, token, status.videoUrl, args.out);
    console.log(`downloaded ${manifest.downloaded.path}`);
  }
  await writeManifest(args.manifest, manifest);
  if (Number(status.status) === 40) throw new Error(`Task failed: ${status.failReason || status.vid || 'unknown'}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
