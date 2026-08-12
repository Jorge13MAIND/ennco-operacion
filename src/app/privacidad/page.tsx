import type { Metadata } from "next";
import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { getRuntimeConfig } from "@/lib/runtime/config";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy/notice";

export const metadata: Metadata = {
  title: "Aviso de privacidad | ENNCO",
  description: "Información sobre el tratamiento de datos personales en el diagnóstico industrial ENNCO.",
};

export default function PrivacyPage() {
  const config = getRuntimeConfig();
  return (
    <>
      <SiteHeader />
      <main className="shell section legal-page">
        <div className="section-head compact">
          <div>
            <p className="eyebrow">Privacidad</p>
            <h1>Aviso de privacidad integral</h1>
          </div>
          <span className="badge">{config.privacyNoticeApproved ? "Vigente" : "Borrador legal"}</span>
        </div>

        {!config.privacyNoticeApproved ? (
          <div className="notice legal-warning" role="status">
            <strong>No aprobado para producción.</strong>
            <p>Este texto implementa la estructura operativa y sigue sujeto a validación legal de ENNCO.</p>
          </div>
        ) : null}

        <article className="legal-card">
          <p className="fine">Versión {PRIVACY_NOTICE_VERSION}. Última actualización: 11 de agosto de 2026.</p>

          <h2>1. Responsable</h2>
          <p>
            Francisco Javier Cuellar Orozco, con nombre comercial ENNCO, es responsable del tratamiento de los datos personales.
            Su domicilio es Calle Fuego 133, Colonia Jardines del Moral, León, Guanajuato, C.P. 37160.
          </p>

          <h2>2. Datos que recabamos</h2>
          <p>
            Nombre, empresa, cargo, correo, teléfono, ciudad, estado, tarifa, gasto energético, capacidad instalada,
            cobertura objetivo, tipo de necesidad, datos de atribución y, cuando se habilite, documentos técnicos que decidas adjuntar.
            No solicitamos datos personales sensibles.
          </p>

          <h2>3. Finalidades</h2>
          <p>
            Usamos los datos para elaborar una referencia preliminar, revisar la necesidad técnica, responder la solicitud,
            dar seguimiento comercial, proteger el sistema, mantener trazabilidad y atender obligaciones legales.
            El envío de comunicaciones comerciales posteriores es una finalidad secundaria que puedes limitar en cualquier momento.
          </p>

          <h2>4. Encargados y transferencias</h2>
          <p>
            Proveedores de infraestructura, almacenamiento, correo, seguridad y soporte podrán tratar datos sólo por instrucciones de ENNCO
            y bajo controles contractuales. No venderemos tus datos. Cualquier transferencia adicional se realizará con la base jurídica y el
            consentimiento que correspondan.
          </p>

          <h2>5. Conservación y seguridad</h2>
          <p>
            Los documentos técnicos se conservan por defecto hasta 90 días después de la última actividad o cierre.
            Los datos de seguimiento se conservan hasta 12 meses desde la última actividad. Los registros de seguridad y auditoría pueden
            conservarse hasta 24 meses. Aplicamos control de acceso, cifrado, cuarentena de archivos, respaldos y trazabilidad.
          </p>

          <h2>6. Derechos ARCO y limitación de uso</h2>
          <p>
            Puedes solicitar acceso, rectificación, cancelación u oposición, así como limitar comunicaciones comerciales, escribiendo a
            <a href="mailto:francisco.cuellar@ennco.com.mx"> francisco.cuellar@ennco.com.mx</a>. Indica tu nombre, el derecho que deseas ejercer,
            la relación con ENNCO y la información necesaria para localizar tu registro. ENNCO podrá pedir acreditación de identidad antes de responder.
          </p>

          <h2>7. Cambios</h2>
          <p>Los cambios a este aviso se publicarán en esta misma dirección, con una nueva fecha y versión.</p>

          <div className="actions">
            <Link className="button secondary" href="/diagnostico">Volver al diagnóstico</Link>
          </div>
        </article>
      </main>
    </>
  );
}
