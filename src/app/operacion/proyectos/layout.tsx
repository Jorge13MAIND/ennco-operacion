import { requireOperationsAccess } from "@/lib/auth/authorization";
import "@/styles/projects.css";

export default async function ProjectsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireOperationsAccess();
  return children;
}
