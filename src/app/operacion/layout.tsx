import { OperationsNav } from "@/components/OperationsNav";
import { SiteHeader } from "@/components/SiteHeader";

export default function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteHeader />
      <div className="shell"><OperationsNav /></div>
      {children}
      <footer className="shell footer">
        <span>ENNCO Control Room.</span>
        <span>Actividad, pipeline y revenue permanecen separados.</span>
      </footer>
    </>
  );
}
