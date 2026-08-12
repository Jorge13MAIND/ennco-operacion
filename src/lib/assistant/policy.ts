import { z } from "zod";

export const assistantInputSchema = z.object({
  message: z.string().trim().min(2).max(1200),
  conversationId: z.uuid().optional(),
  proposalFolio: z.string().trim().min(3).max(80).optional(),
});

export type AssistantAction = "ANSWER" | "HANDOFF" | "REFUSE";

export type AssistantResult = {
  action: AssistantAction;
  topic: string;
  answer: string;
  groundedIn: string[];
  nextStep: "NONE" | "PACO_REVIEW" | "TECHNICAL_REVIEW";
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matches(value: string, expressions: RegExp[]): boolean {
  return expressions.some((expression) => expression.test(value));
}

const promptAttackPatterns = [
  /ignora (tus|las|todas) instrucciones/,
  /revela (el|tu) (prompt|sistema|instrucciones)/,
  /system prompt/,
  /developer message/,
  /actua como si no tuvieras reglas/,
  /extrae (secretos|credenciales|tokens)/,
];

const commercialApprovalPatterns = [
  /garanti/,
  /descuento/,
  /precio (exacto|final|cerrado)/,
  /cuanto (cuesta|sale)/,
  /cotizacion final/,
  /condiciones de pago/,
];

const dateCommitmentPatterns = [
  /fecha de instalacion/,
  /cuando (queda|terminan|instalan)/,
  /tiempo exacto/,
  /plazo de entrega/,
];

const legalTaxPatterns = [
  /deduc/,
  /beneficio fiscal/,
  /isr/,
  /impuesto/,
  /cumple con la nom/,
  /responsabilidad legal/,
];

const technicalApprovalPatterns = [
  /viabilidad estructural/,
  /capacidad estructural/,
  /estructura (aguanta|soporta)/,
  /dictamen definitivo/,
  /dimensionamiento final/,
  /ingenieria de detalle/,
];

export function evaluateAssistantMessage(rawMessage: string): AssistantResult {
  const message = normalize(rawMessage);

  if (matches(message, promptAttackPatterns)) {
    return {
      action: "REFUSE",
      topic: "SECURITY",
      answer: "No puedo cambiar las reglas del asistente ni revelar configuración interna. Sí puedo explicar el alcance y el proceso documentado de ENNCO.",
      groundedIn: ["assistant_policy_v1"],
      nextStep: "NONE",
    };
  }

  if (matches(message, commercialApprovalPatterns)) {
    return {
      action: "HANDOFF",
      topic: "COMMERCIAL_APPROVAL",
      answer: "Ese punto lo confirma Paco durante la revisión comercial, después de validar el alcance técnico. Puedo ayudarte a reunir la información necesaria para esa revisión.",
      groundedIn: ["DEC-011", "transcript_aug_3"],
      nextStep: "PACO_REVIEW",
    };
  }

  if (matches(message, dateCommitmentPatterns)) {
    return {
      action: "HANDOFF",
      topic: "DELIVERY_COMMITMENT",
      answer: "El calendario depende del levantamiento, el alcance y las condiciones de la planta. El equipo técnico debe revisarlo antes de confirmar una fecha.",
      groundedIn: ["transcript_aug_5", "DEC-011"],
      nextStep: "TECHNICAL_REVIEW",
    };
  }

  if (matches(message, legalTaxPatterns)) {
    return {
      action: "HANDOFF",
      topic: "LEGAL_OR_TAX",
      answer: "Ese punto requiere revisión del equipo comercial y del asesor correspondiente para el proyecto. No lo voy a presentar como un beneficio definitivo.",
      groundedIn: ["DEC-011", "prequote_policy_v2"],
      nextStep: "PACO_REVIEW",
    };
  }

  if (matches(message, technicalApprovalPatterns)) {
    return {
      action: "HANDOFF",
      topic: "TECHNICAL_APPROVAL",
      answer: "Eso sólo puede definirse con información de la planta y revisión técnica. Puedo indicarte los datos iniciales, pero ingeniería debe validar la conclusión.",
      groundedIn: ["transcript_aug_3", "prequote_policy_v2"],
      nextStep: "TECHNICAL_REVIEW",
    };
  }

  if (matches(message, [/que (necesitan|dato|datos)|recibo|capacidad instalada|informacion inicial|diagnostico|pre.?cotizacion/])) {
    return {
      action: "ANSWER",
      topic: "INITIAL_INPUTS",
      answer: "Para una revisión inicial, ENNCO parte del recibo de CFE cuando se evalúa un sistema nuevo, o de la capacidad instalada cuando ya existe uno. También necesita ubicación, tipo de zona y el objetivo de la planta.",
      groundedIn: ["transcript_aug_3_lines_141_143"],
      nextStep: "NONE",
    };
  }

  if (matches(message, [/quien decide|quien participa|compras|direccion|director/])) {
    return {
      action: "ANSWER",
      topic: "STAKEHOLDERS",
      answer: "En un proyecto industrial suelen participar dirección, mantenimiento, compras e ingeniería. ENNCO busca que todas las áreas revisen los mismos supuestos y el mismo alcance documentado.",
      groundedIn: ["transcript_aug_3_lines_128_131", "transcript_aug_5_lines_24_27"],
      nextStep: "NONE",
    };
  }

  if (matches(message, [/como (trabajan|es el proceso)|proceso|siguiente paso|visita tecnica|levantamiento|reunion/])) {
    return {
      action: "ANSWER",
      topic: "PROCESS",
      answer: "El proceso empieza con contexto y datos, sigue con un diagnóstico preliminar y, si hace sentido, una visita técnica. Después se documentan observaciones y alcance para preparar la propuesta correspondiente.",
      groundedIn: ["transcript_aug_5_lines_8_12"],
      nextStep: "NONE",
    };
  }

  if (matches(message, [/que (hace|servicios)|servicios|paneles|solar|termografia|transformador|mantenimiento|instalacion electrica|baterias|almacenamiento/])) {
    return {
      action: "ANSWER",
      topic: "SERVICES",
      answer: "ENNCO trabaja ingeniería e instalaciones eléctricas industriales, solar, mantenimiento preventivo y correctivo, termografía, transformadores y almacenamiento. El alcance correcto depende de la necesidad y las condiciones de cada planta.",
      groundedIn: ["transcript_aug_3_lines_31_35_71"],
      nextStep: "NONE",
    };
  }

  return {
    action: "HANDOFF",
    topic: "UNKNOWN",
    answer: "No tengo evidencia suficiente para responder eso con precisión. Puedo registrar la pregunta para que Paco o el equipo técnico la revise con el contexto del proyecto.",
    groundedIn: ["assistant_policy_v1"],
    nextStep: "PACO_REVIEW",
  };
}
