import { ProjectsOverview } from "@/components/projects/ProjectsOverview";
export const dynamic = "force-dynamic";
export default function ProjectListPage() {
  return <ProjectsOverview view="list" />;
}
