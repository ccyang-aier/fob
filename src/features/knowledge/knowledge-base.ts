export type KnowledgeBaseSource = 'local' | 'server';
/** A knowledge base is Fob's sole workspace and resource scope. */
export type KnowledgeBaseResource = { id: string; name: string; source: KnowledgeBaseSource };
