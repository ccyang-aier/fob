export { PAGE_BODY_FRAGMENT, extractPageBodyReferences, resolvePageReferences, refreshPageBacklinks, readPageOutgoingReferences, readPageBacklinks, countPageBacklinkRows, createBacklinkConsumer } from './backlinks';
export type { PageBodyReference, ResolvedPageReference, PageBacklinkRefresh, PageBacklink } from './backlinks';
export { searchBlocksByKeyword } from './keyword';
export type { KeywordSearchInput } from './keyword';
export { searchHybrid } from './service';
export type { SearchGateway, HybridSearchInput, HybridSearchOptions } from './service';
export { createBlockEmbeddingConsumer, rebuildKnowledgeBaseEmbeddings, refreshPageEmbeddings, readActiveEmbeddingModel, embeddingInput, embeddingInputHash, EmbeddingRebuildError } from './embeddings';
