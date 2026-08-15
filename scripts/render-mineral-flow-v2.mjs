#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const ROOT = process.cwd();
const SOURCE = path.resolve(
  ROOT,
  "public/media/generated/workbench-luxury-nocturne-c-rh/workbench-luxury-nocturne-c-obsidian-pearl.png",
);
const OUTPUT_DIR = path.resolve(ROOT, "public/media/generated/workbench-luxury-nocturne-c-rh");
const EVIDENCE_DIR = path.resolve(ROOT, "output/mineral-flow-v2");
const CAPTURE = path.join(EVIDENCE_DIR, "workbench-mineral-flow-v2-capture.webm");
const WEBM = path.join(OUTPUT_DIR, "workbench-mineral-flow-v2.webm");
const MP4 = path.join(OUTPUT_DIR, "workbench-mineral-flow-v2.mp4");
const POSTER = path.join(EVIDENCE_DIR, "workbench-mineral-flow-v2-poster.png");
const WIDTH = 1920;
const HEIGHT = 1200;
const FPS = 30;
const DURATION_SECONDS = 18;
const FRAME_COUNT = FPS * DURATION_SECONDS;
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const browserExecutable = browserCandidates.find((candidate) => existsSync(candidate));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr}`));
    });
  });
}

async function sha256(file) {
  const buffer = await readFile(file);
  return createHash("sha256").update(buffer).digest("hex");
}

function pageMarkup(sourceDataUrl) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><style>html,body{margin:0;background:#090a0c;overflow:hidden}canvas{display:block;width:${WIDTH}px;height:${HEIGHT}px}</style></head>
<body><canvas id="canvas" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script>
const sourceUrl = ${JSON.stringify(sourceDataUrl)};
const width = ${WIDTH};
const height = ${HEIGHT};
const frameCount = ${FRAME_COUNT};
const fps = ${FPS};
const canvas = document.querySelector('#canvas');
const gl = canvas.getContext('webgl2', {alpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:true});
if (!gl) throw new Error('WEBGL2_UNAVAILABLE');

const vertexSource = \`#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main(){
  v_uv = a_position * .5 + .5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}\`;

const fragmentSource = \`#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_phase;
uniform vec2 u_resolution;
in vec2 v_uv;
out vec4 outColor;

const float TAU = 6.28318530718;

float luminance(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
float saturation(vec3 c){ return max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)); }

vec2 coverUv(vec2 uv){
  float sourceAspect = 3840.0 / 2160.0;
  float targetAspect = u_resolution.x / u_resolution.y;
  if (targetAspect < sourceAspect) uv.x = (uv.x - .5) * (targetAspect / sourceAspect) + .5;
  else uv.y = (uv.y - .5) * (sourceAspect / targetAspect) + .5;
  return uv;
}

vec2 periodicCurl(vec2 p, float t){
  float x = p.x;
  float y = p.y;
  float a = TAU * (2.0*x + 1.0*y) + t;
  float b = TAU * (-1.0*x + 3.0*y) - 2.0*t;
  float c = TAU * (4.0*x - 2.0*y) + 3.0*t;
  float d = TAU * (1.0*x + 5.0*y) - t;
  float dPsiDx = TAU * (2.0*.62*cos(a) - 1.0*.31*cos(b) + 4.0*.16*cos(c) + 1.0*.10*cos(d));
  float dPsiDy = TAU * (1.0*.62*cos(a) + 3.0*.31*cos(b) - 2.0*.16*cos(c) + 5.0*.10*cos(d));
  return vec2(dPsiDy, -dPsiDx) / 15.0;
}

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main(){
  vec2 base = coverUv(v_uv);
  float t = u_phase * TAU;
  vec3 original = texture(u_texture, base).rgb;
  float l0 = luminance(original);
  float s0 = saturation(original);

  float mineralMask = smoothstep(.055, .48, l0) * (.42 + .58*smoothstep(.025,.24,s0));
  float quietDark = smoothstep(.02,.16,l0);
  vec2 curlA = periodicCurl(base*1.10 + vec2(.07,-.04), t);
  vec2 curlB = periodicCurl(base*1.85 + vec2(-.11,.13), -t);
  vec2 slowDrift = vec2(sin(t + base.y*TAU), cos(t - base.x*TAU)) * .0038;
  vec2 displacement = (curlA*.0340 + curlB*.0115 + slowDrift) * mineralMask * quietDark;
  vec2 warped = clamp(base + displacement, vec2(.002), vec2(.998));

  vec3 refracted = texture(u_texture, warped).rgb;
  float e = 1.35 / min(u_resolution.x, u_resolution.y);
  float hx = luminance(texture(u_texture, warped + vec2(e,0)).rgb) - luminance(texture(u_texture, warped - vec2(e,0)).rgb);
  float hy = luminance(texture(u_texture, warped + vec2(0,e)).rgb) - luminance(texture(u_texture, warped - vec2(0,e)).rgb);
  vec3 normal = normalize(vec3(-hx*9.0, -hy*9.0, 1.0));
  vec3 lightA = normalize(vec3(.34 + .22*cos(t), -.22 + .14*sin(t), .91));
  vec3 lightB = normalize(vec3(-.42 + .16*sin(t), .18 + .08*cos(t), .88));
  float specA = pow(max(dot(normal, lightA),0.0), 18.0);
  float specB = pow(max(dot(normal, lightB),0.0), 30.0);
  float pearl = smoothstep(.10,.62,luminance(refracted)) * smoothstep(.035,.30,saturation(refracted));

  vec3 color = mix(original, refracted, .22 + .58*mineralMask);
  vec3 coldPearl = vec3(.23,.16,.31) * specA * pearl * .28;
  vec3 agedBronze = vec3(.28,.17,.075) * specB * pearl * .14;
  color += coldPearl + agedBronze;
  color = mix(original*.995, color, .30 + .70*quietDark);
  color = color * vec3(.965,.955,.98);
  color = (color - .5) * .985 + .5;
  float vignette = smoothstep(.95,.30,length(v_uv-.5));
  color *= .92 + .08*vignette;
  float dither = (hash12(gl_FragCoord.xy + u_phase*97.0)-.5) / 255.0;
  color += dither*.42;
  outColor = vec4(clamp(color,0.0,1.0),1.0);
}\`;

function shader(type, source){
  const item=gl.createShader(type); gl.shaderSource(item,source); gl.compileShader(item);
  if(!gl.getShaderParameter(item,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(item));
  return item;
}
const program=gl.createProgram();
gl.attachShader(program,shader(gl.VERTEX_SHADER,vertexSource));
gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragmentSource));
gl.linkProgram(program);
if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
const buffer=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
const position=gl.getAttribLocation(program,'a_position');
gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
const phaseLocation=gl.getUniformLocation(program,'u_phase');
gl.uniform2f(gl.getUniformLocation(program,'u_resolution'),width,height);
const texture=gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D,texture);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);

function render(phase){
  gl.viewport(0,0,width,height);
  gl.uniform1f(phaseLocation,phase);
  gl.drawArrays(gl.TRIANGLES,0,6);
  gl.finish();
}

window.renderMineralLoop = async function(){
  const image = new Image();
  image.crossOrigin='anonymous';
  image.src=sourceUrl;
  await image.decode();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
  render(0);
  window.__mineralReady=true;
  const mimeCandidates=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const mimeType=mimeCandidates.find((item)=>MediaRecorder.isTypeSupported(item));
  if(!mimeType) throw new Error('MEDIA_RECORDER_WEBM_UNAVAILABLE');
  const stream=canvas.captureStream(0);
  const track=stream.getVideoTracks()[0];
  const chunks=[];
  const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:16000000});
  recorder.ondataavailable=(event)=>{if(event.data.size)chunks.push(event.data)};
  const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=()=>reject(recorder.error)});
  recorder.start(1000);
  const start=performance.now();
  for(let frame=0;frame<frameCount;frame++){
    const due=start+frame*(1000/fps);
    const wait=due-performance.now();
    if(wait>0) await new Promise((resolve)=>setTimeout(resolve,wait));
    render(frame/frameCount);
    track.requestFrame();
  }
  await new Promise((resolve)=>setTimeout(resolve,80));
  recorder.stop();
  await stopped;
  track.stop();
  const blob=new Blob(chunks,{type:mimeType});
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let binary='';
  const chunkSize=0x8000;
  for(let i=0;i<bytes.length;i+=chunkSize) binary+=String.fromCharCode(...bytes.subarray(i,i+chunkSize));
  return {base64:btoa(binary),mimeType,size:bytes.length,frames:frameCount,elapsedMs:performance.now()-start};
};
</script></body></html>`;
}

await mkdir(OUTPUT_DIR, { recursive: true });
await mkdir(EVIDENCE_DIR, { recursive: true });
const sourceBuffer = await readFile(SOURCE);
const sourceUrl = "https://mineral.local/source.png";
const browser = await chromium.launch({
  headless: true,
  ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  args: [
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  page.on("pageerror", (error) => process.stderr.write(`[pageerror] ${error.stack || error.message}\n`));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") process.stderr.write(`[browser:${message.type()}] ${message.text()}\n`);
  });
  await page.route(sourceUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
      body: sourceBuffer,
    }),
  );
  await page.setContent(pageMarkup(sourceUrl), { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => typeof window.renderMineralLoop === "function");
  await page.evaluate(() => {
    const promise = window.renderMineralLoop();
    window.__mineralCapturePromise = promise;
    promise.catch((error) => {
      window.__mineralError = error?.stack || error?.message || String(error);
    });
  });
  await page.waitForFunction(() => window.__mineralReady === true || Boolean(window.__mineralError), null, { timeout: 60_000 });
  const pageError = await page.evaluate(() => window.__mineralError || null);
  if (pageError) throw new Error(pageError);
  await page.locator("canvas").screenshot({ path: POSTER, type: "png" });
  const capture = await page.evaluate(() => window.__mineralCapturePromise);
  await writeFile(CAPTURE, Buffer.from(capture.base64, "base64"));
  const { base64: _base64, ...captureMetadata } = capture;
  process.stdout.write(`${JSON.stringify({ stage: "capture", ...captureMetadata, path: CAPTURE })}\n`);
} finally {
  await browser.close();
}

await run("ffmpeg", [
  "-y", "-i", CAPTURE,
  "-vf", `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
  "-frames:v", String(FRAME_COUNT),
  "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30",
  "-deadline", "good", "-cpu-used", "2", "-row-mt", "1", "-tile-columns", "2",
  "-pix_fmt", "yuv420p", WEBM,
]);

await run("ffmpeg", [
  "-y", "-i", CAPTURE,
  "-vf", `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos`,
  "-frames:v", String(FRAME_COUNT),
  "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", MP4,
]);

const manifest = {
  schemaVersion: 1,
  source: path.relative(ROOT, SOURCE).replaceAll("\\", "/"),
  sourceSha256: await sha256(SOURCE),
  render: {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    durationSeconds: DURATION_SECONDS,
    frames: FRAME_COUNT,
    periodicPhase: true,
    runtimeShader: false,
  },
  outputs: {},
};
for (const [name, file] of Object.entries({ webm: WEBM, mp4: MP4, poster: POSTER, capture: CAPTURE })) {
  manifest.outputs[name] = {
    path: path.relative(ROOT, file).replaceAll("\\", "/"),
    bytes: (await stat(file)).size,
    sha256: await sha256(file),
  };
}
await writeFile(path.join(EVIDENCE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ stage: "complete", manifest }, null, 2)}\n`);
