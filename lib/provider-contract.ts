export type ProviderKind = "text" | "image" | "video" | "speech";
export type LogicalModelId = "gpt-5.5" | "gpt-5.6" | "seedance-2" | "image-provider" | "speech-provider";

export interface GenerationRequest {
  projectId: string;
  kind: ProviderKind;
  prompt: string;
  model?: string;
  referenceAssetIds?: string[];
  options?: Record<string, string | number | boolean>;
}

export interface GenerationJob {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  outputAssetIds: string[];
  error?: string;
}

export interface ModelProvider {
  submit(input: GenerationRequest): Promise<GenerationJob>;
  getJob(jobId: string): Promise<GenerationJob>;
  cancel(jobId: string): Promise<void>;
}

export interface ProviderDescriptor {
  id: LogicalModelId;
  label: string;
  kind: ProviderKind;
  purpose: string;
  apiBaseEnv: string;
  apiKeyEnv: string;
  modelEnv: string;
  configured: boolean;
}

export const providerDescriptors: ProviderDescriptor[] = [
  { id: "gpt-5.5", label: "GPT-5.5", kind: "text", purpose: "证据整理、剧本拆解与初稿", apiBaseEnv: "NIANNIAN_GPT_API_BASE_URL", apiKeyEnv: "NIANNIAN_GPT_API_KEY", modelEnv: "NIANNIAN_GPT55_MODEL", configured: false },
  { id: "gpt-5.6", label: "GPT-5.6", kind: "text", purpose: "本土化、连续性与导演级复核", apiBaseEnv: "NIANNIAN_GPT_API_BASE_URL", apiKeyEnv: "NIANNIAN_GPT_API_KEY", modelEnv: "NIANNIAN_GPT56_MODEL", configured: false },
  { id: "seedance-2", label: "Seedance 2", kind: "video", purpose: "已授权镜头的视频生成", apiBaseEnv: "NIANNIAN_SEEDANCE_API_BASE_URL", apiKeyEnv: "NIANNIAN_SEEDANCE_API_KEY", modelEnv: "NIANNIAN_SEEDANCE2_MODEL", configured: false },
];

export const providerSlots = [
  { kind: "text", icon: "文", label: "文本与导演模型", description: "GPT-5.5 初稿 + GPT-5.6 复核", candidates: ["GPT-5.5", "GPT-5.6", "OpenAI 兼容别名"], placeholder: "由服务端环境变量配置" },
  { kind: "image", icon: "图", label: "图像生成模型", description: "角色、场景、道具与首帧", candidates: ["Image2", "即梦", "RunningHub", "自有模型"], placeholder: "例如：your-image-model" },
  { kind: "video", icon: "影", label: "视频生成模型", description: "真人短剧镜头生成与运镜", candidates: ["Seedance 2"], placeholder: "NIANNIAN_SEEDANCE2_MODEL" },
  { kind: "speech", icon: "声", label: "语音与声音模型", description: "配音、音效、音乐与字幕", candidates: ["火山引擎", "MiniMax", "Azure Speech", "自有模型"], placeholder: "例如：your-speech-model" },
] as const;
