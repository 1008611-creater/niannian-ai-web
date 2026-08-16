/** Upper bound used when an upstream model reports no model-specific limit. */
export const ZIYU_PROMPT_FALLBACK_MAX_LENGTH = 10_000;

export function ziyuPromptMaxLength(modelLimit: number | undefined) {
  return typeof modelLimit === "number" && modelLimit > 0 ? modelLimit : ZIYU_PROMPT_FALLBACK_MAX_LENGTH;
}
