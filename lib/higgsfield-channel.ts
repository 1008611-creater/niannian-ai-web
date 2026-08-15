export const higgsfieldSkillChain = [
  "ai-video-production-router",
  "ai-video-channel-router",
  "higgsfield-cinema-studio-cli",
] as const;

export const HIGGSFIELD_CHANNEL = "higgsfield" as const;
export const HIGGSFIELD_MODEL = "Cinematic Studio Video 3.5" as const;
export const HIGGSFIELD_MODEL_ID = "cinematic_studio_video_3_5" as const;

export function higgsfieldReferencePlan(references: Array<Record<string, unknown>>) {
  const ranked = [...references].sort((left, right) => {
    const primary = Number(right.is_primary === true) - Number(left.is_primary === true);
    return primary || Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0);
  });
  const selected = ranked[0];
  return {
    channel: HIGGSFIELD_CHANNEL,
    execution: "official_higgsfield_cli",
    entry_path: "https://mcp.higgsfield.ai/mcp",
    model_id: HIGGSFIELD_MODEL_ID,
    max_upload_references: 1,
    supports_multi_reference: false,
    selected_reference_keys: selected ? [String(selected.ref_key)] : [],
    selections: ranked.map((reference, index) => ({
      ref_key: String(reference.ref_key),
      selected: index === 0,
      selection_rank: index + 1,
      reason: index === 0
        ? "selected as the single Higgsfield Cinema Studio start-image reference"
        : "retained in the task spec but not uploaded by the single-reference launch route",
    })),
  };
}
