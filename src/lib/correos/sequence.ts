import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Secuencia del carril directo: 8 toques × 4 variantes = 32 correos, generada
 * desde docs/external/secuencia-ennco-copy.md por scripts/build-direct-lane-sequence.mts
 * y congelada en data/campaigns/direct-lane-sequence-v1.json con hash.
 *
 * Las variantes se asignan por CONTACTO según su cargo (roles.ts); donde no
 * hay candidato de compras, la cuenta simplemente no usa esa variante.
 */

export const DIRECT_LANE_VARIANT_KEYS = ["DIRECCION", "MANTENIMIENTO", "SEGURIDAD", "COMPRAS"] as const;
export type DirectLaneVariantKey = (typeof DIRECT_LANE_VARIANT_KEYS)[number];

export const DIRECT_LANE_DAY_OFFSETS = [0, 3, 7, 14, 28, 42, 60, 75] as const;

const touchSchema = z.object({
  touch_number: z.number().int().min(1).max(8),
  day_offset: z.number().int().min(0).max(365),
  subject: z.string().trim().min(3).max(180),
  body: z.string().trim().min(20).max(2_000),
}).strict();

const variantSchema = z.object({
  key: z.enum(DIRECT_LANE_VARIANT_KEYS),
  label: z.string().trim().min(3).max(80),
  touches: z.array(touchSchema).length(8),
}).strict();

export const directLaneSequenceSchema = z.object({
  schema_version: z.literal("1.0.0"),
  source: z.string().trim().min(3),
  source_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  generated_at: z.iso.datetime({ offset: true }),
  sender_name: z.string().trim().min(3).max(120),
  sender_title: z.string().trim().min(2).max(120),
  day_offsets: z.array(z.number().int()).length(8),
  variants: z.array(variantSchema).length(4),
}).strict();

export type DirectLaneSequence = z.infer<typeof directLaneSequenceSchema>;

export function countWords(value: string): number {
  return value.split(/\s+/u).filter(Boolean).length;
}

/** Reglas duras del copy (docs/external/secuencia-ennco-copy.md § Reglas duras del sistema). */
export function validateDirectLaneSequence(sequence: DirectLaneSequence): string[] {
  const problems: string[] = [];
  if (sequence.day_offsets.join(",") !== DIRECT_LANE_DAY_OFFSETS.join(",")) {
    problems.push(`day_offsets esperados ${DIRECT_LANE_DAY_OFFSETS.join(",")}`);
  }
  const seen = new Set<string>();
  for (const variant of sequence.variants) {
    if (seen.has(variant.key)) problems.push(`variante duplicada ${variant.key}`);
    seen.add(variant.key);
    variant.touches.forEach((touch, index) => {
      const label = `${variant.key} toque ${touch.touch_number}`;
      if (touch.touch_number !== index + 1) problems.push(`${label}: número fuera de orden`);
      if (touch.day_offset !== DIRECT_LANE_DAY_OFFSETS[index]) problems.push(`${label}: day_offset ${touch.day_offset}`);
      const words = countWords(touch.body);
      if (words > 100) problems.push(`${label}: ${words} palabras (tope 100)`);
      if (/<[^>]+>/u.test(touch.body)) problems.push(`${label}: HTML prohibido`);
      if (touch.touch_number === 1 && /(?:https?:\/\/|www\.|mailto:)/iu.test(touch.body)) problems.push(`${label}: liga en toque 1`);
      if (/\{\{(?!first_name\}\}|company\}\})/u.test(`${touch.subject}${touch.body}`)) problems.push(`${label}: token desconocido`);
      if (/garant[ií]a|descuento|precio final/iu.test(touch.body)) problems.push(`${label}: promesa prohibida`);
      if (touch.touch_number === 8 && !/baja|no volver|dejo de escribir|no te escribo m[aá]s/iu.test(touch.body)) {
        problems.push(`${label}: el toque 8 debe llevar baja explícita`);
      }
    });
  }
  return problems;
}

export function variantContentSha256(variant: DirectLaneSequence["variants"][number]): string {
  return createHash("sha256").update(JSON.stringify(variant.touches.map((touch) => [touch.touch_number, touch.day_offset, touch.subject, touch.body]))).digest("hex");
}

export function sequenceContentSha256(sequence: DirectLaneSequence): string {
  return createHash("sha256").update(sequence.variants.map((variant) => `${variant.key}:${variantContentSha256(variant)}`).join("\n")).digest("hex");
}

export type RenderValues = { first_name: string; company: string };

export function renderDirectLaneTemplate(template: string, values: RenderValues): string {
  return template.replace(/\{\{(first_name|company)\}\}/gu, (_, key: keyof RenderValues) => values[key].trim());
}

/** Payload exacto que recibe create_direct_lane_campaign en la base. */
export function directLaneSequencePayload(sequence: DirectLaneSequence): Record<string, unknown> {
  return {
    source: sequence.source,
    source_sha256: sequence.source_sha256,
    content_sha256: sequenceContentSha256(sequence),
    sender_name: sequence.sender_name,
    sender_title: sequence.sender_title,
    day_offsets: [...sequence.day_offsets],
    variants: sequence.variants.map((variant, index) => ({
      key: variant.key,
      label: variant.label,
      version: index + 1,
      content_sha256: variantContentSha256(variant),
      touches: variant.touches.map((touch) => ({
        touch_number: touch.touch_number,
        day_offset: touch.day_offset,
        subject: touch.subject,
        body: touch.body,
      })),
    })),
  };
}
