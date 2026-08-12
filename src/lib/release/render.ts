type SequenceVariant = {
  subject: string;
  body: string;
};

type SequenceTouch = {
  touch_number: number;
  variants: Record<string, SequenceVariant>;
};

export type SequenceDefinition = {
  touches: SequenceTouch[];
};

export type RenderValues = {
  first_name: string;
  company: string;
  observed_signal: string;
  source_name: string;
};

export function renderSequenceTouch(
  sequence: SequenceDefinition,
  touchNumber: number,
  variantName: string,
  values: RenderValues,
): SequenceVariant {
  const touch = sequence.touches.find((candidate) => candidate.touch_number === touchNumber);
  if (!touch) throw new Error("TOUCH_NOT_FOUND");
  const variant = touch.variants[variantName];
  if (!variant) throw new Error("VARIANT_NOT_FOUND");
  const render = (template: string) => template.replace(/\{\{([a-z_]+)\}\}/g, (_, key: keyof RenderValues) => {
    const value = values[key];
    if (!value || value.trim().length === 0) throw new Error(`MISSING_RENDER_VALUE:${key}`);
    return value.trim();
  });
  const subject = render(variant.subject);
  const body = render(variant.body);
  if (/\{\{[^}]+\}\}/.test(`${subject}${body}`)) throw new Error("UNRESOLVED_TEMPLATE_TOKEN");
  return { subject, body };
}

