import { WorkbenchShell } from "@/shell/workbench-shell"
import { ProjectResourceProvider } from "@/features/project/project-resources"

export default function Home() {
  return <ProjectResourceProvider><WorkbenchShell /></ProjectResourceProvider>
}
