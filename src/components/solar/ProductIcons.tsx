/* Iconos a trazo de los tipos de producto, en el estilo de la barra lateral (caja 24, trazo 1.75, currentColor). */

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export function ProductTypeIcon({ icon }: { icon: string }) {
  const paths: Record<string, React.ReactNode> = {
    panel: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9.3h18M3 14.7h18M9 4v16M15 4v16" /></>,
    inverter: <><rect x="5" y="3" width="14" height="18" rx="2.5" /><circle cx="12" cy="13" r="3.5" /><path d="M12 3v6" /></>,
    structure: <><path d="M12 4 3 20h18L12 4Z" /><path d="M12 4v16M7.5 12h9" /></>,
    wrench: <><path d="M14.7 6.3a4 4 0 0 0 5 5L9.6 21.4a2 2 0 0 1-2.9-2.9L16.8 8.4" /><path d="M14 4.5a4.5 4.5 0 0 1 5.5 5.5" /></>,
    "list-plus": <><path d="M4 6h11M4 12h11M4 18h7" /><circle cx="18" cy="17" r="3.5" /><path d="M18 15.3v3.4M16.3 17h3.4" /></>,
    battery: <><rect x="3" y="7" width="16" height="10" rx="2" /><path d="M21 10v4M7 10v4M11 10v4" /></>,
    controller: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 12h8M12 8v8" /></>,
    box: <><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" /><path d="M4 7l8 4 8-4M12 11v10" /></>,
  };
  return <svg {...base}>{paths[icon] ?? paths.box}</svg>;
}

export const Icons = {
  star: (on: boolean) => <svg {...base} fill={on ? "currentColor" : "none"}><path d="m12 3.5 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.4l-5.4 2.9 1.1-6.1L3.2 9.9l6.1-.8L12 3.5Z" /></svg>,
  download: <svg {...base}><path d="M12 4v11M7 10l5 5 5-5M4 19h16" /></svg>,
  upload: <svg {...base}><path d="M12 19V8M7 13l5-5 5 5M4 20h16" /></svg>,
  trash: <svg {...base}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>,
  camera: <svg {...base}><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  doc: <svg {...base}><path d="M7 3h7l5 5v13H7V3Z" /><path d="M14 3v5h5M10 12h6M10 16h6" /></svg>,
  back: <svg {...base}><path d="m14 6-6 6 6 6" /></svg>,
  list: <svg {...base}><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  grid: <svg {...base}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>,
  plus: <svg {...base}><path d="M12 5v14M5 12h14" /></svg>,
  search: <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  unit: <svg {...base}><rect x="6" y="9" width="12" height="11" rx="2" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>,
  range: <svg {...base}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>,
};
