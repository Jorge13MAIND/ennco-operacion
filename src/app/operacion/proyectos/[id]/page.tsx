import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";
export const dynamic = "force-dynamic";
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    notFound();
  return <ProjectWorkspace id={id} tab={(await searchParams).tab ?? "datos"} />;
}
