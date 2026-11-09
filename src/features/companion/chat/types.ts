import type { AssistantConversation, AssistantSettings, AssistantTurn } from '@fob/shared/knowledge/contracts';

export type CompanionChatMode = 'document' | 'knowledgeBase';
export type CompanionDocumentContext = { pageId: string; title: string; editable?: boolean };

/** Published by the active workspace; never inferred from page DOM or URL text. */
export type CompanionChatContext = {
  status: 'checking' | 'ready' | 'signed-out' | 'no-knowledge-base' | 'local' | 'error';
  userId: string | null;
  knowledgeBaseId: string | null;
  knowledgeBaseName: string;
  canConfigureAI: boolean;
  document: CompanionDocumentContext | null;
};

export type CompanionChatScope = { userId: string; knowledgeBaseId: string; pageId: string | null };
export type CompanionConversationSummary = Pick<AssistantConversation, 'id' | 'title' | 'updatedAt'>;

/** UI-independent private conversation controller. Only IDs may be stored in browser storage. */
export interface CompanionChatController {
  conversation: AssistantConversation | null;
  conversations: readonly CompanionConversationSummary[];
  settings: AssistantSettings | null;
  loading: boolean;
  historyLoading: boolean;
  settingsLoading: boolean;
  busy: boolean;
  ready: boolean;
  truncated: boolean;
  errorCode: string | null;
  historyError: string | null;
  send(question: string, mode: CompanionChatMode, onStarted?: () => void): Promise<void>;
  retry(turn: AssistantTurn): Promise<void>;
  stop(): Promise<void>;
  newConversation(): void;
  selectConversation(id: string): Promise<void>;
  removeConversation(id: string): Promise<void>;
  refresh(): Promise<void>;
  clearError(): void;
}
