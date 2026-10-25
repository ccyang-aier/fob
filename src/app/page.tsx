import { WorkbenchShell } from "@/shell/workbench-shell"
import { KnowledgeBaseProvider } from "@/features/knowledge/data/knowledge-base-resources"
import { RewardsProvider } from "@/features/rewards"

export default function Home() {
  return <KnowledgeBaseProvider><RewardsProvider><WorkbenchShell /></RewardsProvider></KnowledgeBaseProvider>
}
