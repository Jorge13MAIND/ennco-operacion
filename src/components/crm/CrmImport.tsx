"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { sendCrmCommand } from "@/components/crm/crm-client";
import { crmImportPreviewSchema, crmImportRowSchema, type CrmImportPreview, type CrmImportRow } from "@/lib/crm/model";
import { z } from "zod";

const previewResponseSchema = z.object({
  file_name: z.string(), columns: z.array(z.object({ field: z.string(), header: z.string() })),
  rows: z.array(crmImportRowSchema), preview: crmImportPreviewSchema,
});
type PreviewResponse = z.infer<typeof previewResponseSchema>;

const ERRORS: Record<string, string> = {
  CRM_IMPORT_FILE_INVALID: "Sube un archivo .xlsx de máximo 3 MB.",
  CRM_IMPORT_FILE_UNREADABLE: "No se pudo leer el Excel. Guárdalo de nuevo como .xlsx e intenta otra vez.",
  CRM_IMPORT_NO_COMPANY_COLUMN: "No encontré una columna \"Empresa\" en las primeras filas.",
  CRM_IMPORT_TOO_MANY_ROWS: "El archivo trae más de 1,000 empresas. Divídelo en partes.",
};
const STATUS_LABELS: Record<CrmImportPreview[number]["status"], string> = {
  NUEVA: "Entra", YA_EN_CRM: "Ya está en el CRM", REPETIDA_EN_ARCHIVO: "Repetida en el archivo", SIN_NOMBRE: "Sin nombre",
};

/** Importar un directorio de empresas: subir, revisar y confirmar (16-oct, Grant). */
export function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null); setData(null); setBusy("Leyendo el archivo…");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/v1/operations/crm/import/preview", { method: "POST", body: form, cache: "no-store" });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) { setError(ERRORS[body?.error ?? ""] ?? "No se pudo revisar el archivo."); return; }
      const parsed = previewResponseSchema.safeParse(body);
      if (!parsed.success) { setError("La respuesta del hub no tiene la forma esperada."); return; }
      setData(parsed.data);
    } catch {
      setError("Sin conexión con el hub. Intenta de nuevo.");
    } finally {
      setBusy(null);
    }
  }

  const fresh: CrmImportRow[] = data ? data.preview.filter((p) => p.status === "NUEVA").map((p) => data.rows[p.index]!).filter(Boolean) : [];
  const counts = data ? {
    nuevas: fresh.length,
    enCrm: data.preview.filter((p) => p.status === "YA_EN_CRM").length,
    repetidas: data.preview.filter((p) => p.status === "REPETIDA_EN_ARCHIVO").length,
    enCampana: data.preview.filter((p) => p.status === "NUEVA" && p.in_email_campaign).length,
  } : null;

  async function confirm() {
    if (!data || fresh.length === 0) return;
    setError(null);
    let inserted = 0;
    for (let start = 0; start < fresh.length; start += 100) {
      setBusy(`Agregando ${Math.min(start + 100, fresh.length)} de ${fresh.length}…`);
      const outcome = await sendCrmCommand({ op: "IMPORTAR", payload: { file_name: data.file_name, rows: fresh.slice(start, start + 100) } });
      if (!outcome.ok) { setBusy(null); setError(`${outcome.message} Se agregaron ${inserted} antes del error.`); return; }
      inserted += Math.min(100, fresh.length - start);
    }
    setBusy(null);
    onDone(`${fresh.length} empresas del directorio agregadas en "Por contactar".`);
  }

  return (
    <dialog ref={ref} className="crm-dialog crm-import" aria-label="Importar directorio" onClose={onClose} onCancel={onClose}>
      <div className="crm-dialog-head">
        <h2>Importar directorio de empresas</h2>
        <button type="button" className="crm-icon-button" onClick={onClose} aria-label="Cerrar">×</button>
      </div>
      <div className="crm-form">
        <p className="crm-dialog-lead">Sube un Excel con una columna <strong>Empresa</strong>. También se leen Municipio o Ciudad, Estado, Parque o Zona, Dirección, Sector o Nota, Fuente y, si vienen, Contacto, Puesto, Correo y Teléfono. Las empresas entran en <strong>Por contactar</strong> con origen <strong>Directorio</strong>.</p>
        <label className="crm-file">
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose} disabled={Boolean(busy)} />
          <span>{data ? `Archivo: ${data.file_name}.xlsx · elegir otro` : "Elegir archivo .xlsx"}</span>
        </label>
        {busy ? <p className="crm-muted" role="status">{busy}</p> : null}
        {error ? <p className="crm-error" role="alert">{error}</p> : null}
        {data && counts ? (
          <>
            <div className="crm-import-summary">
              <div data-tone="good"><strong>{counts.nuevas}</strong><span>entran</span></div>
              <div><strong>{counts.enCrm}</strong><span>ya estaban en el CRM</span></div>
              <div><strong>{counts.repetidas}</strong><span>repetidas en el archivo</span></div>
              <div data-tone="info"><strong>{counts.enCampana}</strong><span>también en campaña de correo</span></div>
            </div>
            <p className="crm-muted">Columnas reconocidas: {data.columns.map((c) => `${c.field} ("${c.header}")`).join(", ")}.</p>
            <div className="table-wrap crm-import-table" role="region" tabIndex={0} aria-label="Vista previa">
              <table className="crm-table">
                <thead><tr><th scope="col">Empresa</th><th scope="col">Lugar</th><th scope="col">Resultado</th></tr></thead>
                <tbody>
                  {data.preview.slice(0, 300).map((p) => {
                    const row = data.rows[p.index];
                    return (
                      <tr key={p.index}>
                        <td data-label="Empresa">{p.company_name}</td>
                        <td data-label="Lugar">{[row?.city, row?.state].filter(Boolean).join(", ")}</td>
                        <td data-label="Resultado">
                          <span className="crm-chip" data-tone={p.status === "NUEVA" ? "good" : undefined}>{STATUS_LABELS[p.status]}</span>
                          {p.in_email_campaign ? <span className="crm-chip" data-tone="info" title={p.account_name ?? undefined}>En campaña de correo</span> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        <div className="crm-dialog-actions">
          <button type="button" className="crm-button" onClick={onClose}>Cancelar</button>
          <button type="button" className="crm-button" data-primary="true" disabled={!counts?.nuevas || Boolean(busy)} onClick={() => void confirm()}>
            {counts ? `Agregar ${counts.nuevas} empresas` : "Agregar"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
