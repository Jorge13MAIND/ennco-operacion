export const PRIVACY_NOTICE_VERSION = "2026-08-11-v1" as const;
export const PRIVACY_NOTICE_LAST_UPDATED = "11 de agosto de 2026" as const;

export const PRIVACY_NOTICE_SECTIONS = [
  {
    title: "Responsable",
    segments: [
      {
        kind: "text",
        value: "Francisco Javier Cuellar Orozco, con nombre comercial ENNCO, es responsable del tratamiento de los datos personales. Su domicilio es Calle Fuego 133, Colonia Jardines del Moral, León, Guanajuato, C.P. 37160.",
      },
    ],
  },
  {
    title: "Datos que recabamos",
    segments: [
      {
        kind: "text",
        value: "Nombre, empresa, cargo, correo, teléfono, ciudad, estado, tarifa, gasto energético, capacidad instalada, cobertura objetivo, tipo de necesidad, datos de atribución y, cuando se habilite, documentos técnicos que decidas adjuntar. No solicitamos datos personales sensibles.",
      },
    ],
  },
  {
    title: "Finalidades",
    segments: [
      {
        kind: "text",
        value: "Usamos los datos para elaborar una referencia preliminar, revisar la necesidad técnica, responder la solicitud, dar seguimiento comercial, proteger el sistema, mantener trazabilidad y atender obligaciones legales. El envío de comunicaciones comerciales posteriores es una finalidad secundaria que puedes limitar en cualquier momento.",
      },
    ],
  },
  {
    title: "Encargados y transferencias",
    segments: [
      {
        kind: "text",
        value: "Proveedores de infraestructura, almacenamiento, correo, seguridad y soporte podrán tratar datos sólo por instrucciones de ENNCO y bajo controles contractuales. No venderemos tus datos. Cualquier transferencia adicional se realizará con la base jurídica y el consentimiento que correspondan.",
      },
    ],
  },
  {
    title: "Conservación y seguridad",
    segments: [
      {
        kind: "text",
        value: "Los documentos técnicos se conservan por defecto hasta 90 días después de la última actividad o cierre. Los datos de seguimiento se conservan hasta 12 meses desde la última actividad. Los registros de seguridad y auditoría pueden conservarse hasta 24 meses. Aplicamos control de acceso, cifrado, cuarentena de archivos, respaldos y trazabilidad.",
      },
    ],
  },
  {
    title: "Derechos ARCO y limitación de uso",
    segments: [
      { kind: "text", value: "Puedes solicitar acceso, rectificación, cancelación u oposición, así como limitar comunicaciones comerciales, escribiendo a " },
      { kind: "email", value: "francisco.cuellar@ennco.com.mx" },
      { kind: "text", value: ". Indica tu nombre, el derecho que deseas ejercer, la relación con ENNCO y la información necesaria para localizar tu registro. ENNCO podrá pedir acreditación de identidad antes de responder." },
    ],
  },
  {
    title: "Cambios",
    segments: [
      {
        kind: "text",
        value: "Los cambios a este aviso se publicarán en esta misma dirección, con una nueva fecha y versión.",
      },
    ],
  },
] as const;

export function serializePrivacyNotice(): string {
  return JSON.stringify({
    version: PRIVACY_NOTICE_VERSION,
    lastUpdated: PRIVACY_NOTICE_LAST_UPDATED,
    sections: PRIVACY_NOTICE_SECTIONS,
  });
}

export const PRIVACY_NOTICE_CONTENT_SHA256 = "d4a24f23350d8a3522f75a169938afe7bcd868c9c812b46aadcbc52681fc718e" as const;
