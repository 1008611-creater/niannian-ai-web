export const astorieSkillChain = [
  "ai-video-production-router",
  "sd2-video-generation",
  "prompt-skill-router",
  "ai-video-channel-router",
  "astorie-seedance2-channel",
] as const;

// The workbench route deliberately exposes only the model proven end to end
// in the authenticated AStorie project canvas.
export const astorieModels = ["Seedance 2.0 Mini"] as const;
export const astorieDurations = Array.from({ length: 12 }, (_, index) => index + 4);

export function validAstorieModel(model: string) {
  return astorieModels.includes(model as (typeof astorieModels)[number]);
}

export function astorieReferencePlan(references: Array<Record<string, unknown>>) {
  const ranked = [...references].sort((left, right) => {
    const primary = Number(right.is_primary === true) - Number(left.is_primary === true);
    if (primary) return primary;
    return Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0);
  });
  const selected = ranked[0];

  return {
    channel: "astorie",
    entry_path: "https://astorie.ai/zh-CN/projects/<authenticated-project-id>",
    max_upload_references: 1,
    supports_multi_reference: false,
    supports_reference_video: false,
    supports_audio_reference: false,
    selected_reference_keys: selected ? [String(selected.ref_key)] : [],
    default_params: {
      models: [...astorieModels],
      resolution: "720P",
      duration_seconds: astorieDurations,
      cost_policy: "Read the visible AStorie charge and balance in the authenticated canvas before Generate. Never infer a price from a duration table.",
    },
    observed_pricing: {
      seedance_2_mini_720p_5s: "65 AStorie credits observed in the provider UI",
      seedance_2_mini_720p_4s: "52 AStorie credits observed in a completed provider run",
      note: "These are observations, not a pricing schedule or authorization.",
    },
    selections: ranked.map((reference, index) => ({
      ref_key: String(reference.ref_key),
      selected: index === 0,
      selection_rank: index + 1,
      reason: index === 0
        ? "selected as the single verified AStorie image reference"
        : "retained in the locked task spec but not uploaded because multi-reference support has not been verified",
    })),
  };
}
