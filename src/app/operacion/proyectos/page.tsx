import { ProjectsOverview } from "@/components/projects/ProjectsOverview";
export const dynamic = "force-dynamic";
export default function ProjectsPage() {
  return <ProjectsOverview view="master" />;
}
