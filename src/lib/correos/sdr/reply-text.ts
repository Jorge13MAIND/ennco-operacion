// Sin dependencias de servidor: lo usan el SDR y la ficha del CRM en el navegador.
export function normalized(text: string) { return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); }
// Firma, avisos legales y citas no son la respuesta: el aviso de Natural de Alimentos ("En cumplimiento
// de la Ley...", "responda con el asunto Quitarme") se leía como compromiso técnico. Siempre es un
// prefijo del cuerpo, así la evidencia sigue siendo una cita literal.
const closingLine = /^\s*(saludos|un saludo|saludo cordial|atentamente|cordialmente|(kind |best )?regards|--|__|enviado desde|sent from|aviso de (privacidad|confidencialidad)|confidentiality notice|\[cid:|el (lun|mar|mie|jue|vie|sab|dom)[a-z]*[.,]? \d|on (mon|tue|wed|thu|fri|sat|sun)[a-z]*,? |de: |from: )/;
export function commercialText(body: string): string {
  for (const line of body.matchAll(/^.*$/gm)) {
    if (line.index > 0 && body.slice(0, line.index).trim() && closingLine.test(normalized(line[0]))) return body.slice(0, line.index).trim();
  }
  return body.trim();
}
