import { PrequoteForm } from "@/components/PrequoteForm";
import { SiteHeader } from "@/components/SiteHeader";

export default function DiagnosticPage() {
  return (
    <>
      <SiteHeader />
      <main className="shell section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Diagnóstico industrial</p>
            <h1>Con el recibo empieza la conversación técnica.</h1>
          </div>
          <span className="badge">synthetic_demo</span>
        </div>
        <PrequoteForm />
      </main>
      <footer className="shell footer">ENNCO. Energy &amp; Innovation Consulting.</footer>
    </>
  );
}
