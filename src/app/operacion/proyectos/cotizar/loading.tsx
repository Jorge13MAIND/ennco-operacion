export default function LoadingProjects() {
  return (
    <main
      className="shell section operations-main projects-page"
      id="main-content"
      tabIndex={-1}
      aria-busy="true"
    >
      <p className="eyebrow">Proyectos ENNCO</p>
      <h1>Preparando tu espacio de trabajo</h1>
      <p role="status">Consultando proyectos y permisos…</p>
    </main>
  );
}
