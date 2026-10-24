import { WorkbenchShell } from "@/shell/workbench-shell"
import { KnowledgeBaseProvider } from "@/features/knowledge/data/knowledge-base-resources"

export default function Home() {
  return <KnowledgeBaseProvider><WorkbenchShell /></KnowledgeBaseProvider>
}
