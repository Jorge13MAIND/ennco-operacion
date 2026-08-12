import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="shell topbar">
      <Link className="brand" href="/">
        <span aria-hidden="true" className="brand-mark">ϟ</span>
        <span>ENNCO</span>
      </Link>
      <nav aria-label="Navegación principal" className="navlinks">
        <Link href="/diagnostico">Diagnóstico</Link>
        <Link href="/operacion">Control Room</Link>
      </nav>
    </header>
  );
}
