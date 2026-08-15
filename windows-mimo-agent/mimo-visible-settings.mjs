export function selectSemanticControl(controls, { semantic, expectedValue, expectedText, labels }) {
  const normalizedLabels = labels.map((label) => String(label).toLowerCase());
  const matches = controls.map((control, index) => ({ control, index })).filter(({ control }) => {
    const description = String(control.description || "").toLowerCase();
    return control.visible === true
      && normalizedLabels.some((label) => description.includes(label))
      && Array.isArray(control.options)
      && control.options.some((option) => option.value === expectedValue || option.text === expectedText);
  });
  if (matches.length !== 1) throw new Error(`SETTING_CONTROL_NOT_VISIBLE:${semantic}`);
  const option = matches[0].control.options.find((entry) => entry.value === expectedValue || entry.text === expectedText);
  if (!option) throw new Error(`SETTING_OPTION_UNAVAILABLE:${semantic}`);
  return { index: matches[0].index, option };
}

export function selectImageToVideoModeControl(controls) {
  const expected = /(?:图生视频|以图生视频|image\s*(?:to|-)?\s*video)/i;
  const matches = controls.map((control, index) => ({ control, index })).filter(({ control }) => {
    if (control.visible !== true) return false;
    const description = String(control.description || "");
    return expected.test(description) || (Array.isArray(control.options) && control.options.some((option) => expected.test(`${option.value} ${option.text}`)));
  });
  if (matches.length !== 1) throw new Error("MODE_CONTROL_NOT_VISIBLE_OR_AMBIGUOUS");
  const { control, index } = matches[0];
  const option = Array.isArray(control.options) ? control.options.find((entry) => expected.test(`${entry.value} ${entry.text}`)) : null;
  return { index, kind: control.kind, option };
}
