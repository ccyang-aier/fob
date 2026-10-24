import type { DocumentIndexStatus, DocumentSource } from './document-metadata';

export type DocumentItem = {
  id: string;
  title: string;
  icon?: string | null;
  updatedAt: string;
  creator: string;
  source: DocumentSource;
  status: DocumentIndexStatus;
  folderId?: string;
  starred?: boolean;
};
export type DocumentFolder = {
  id: string;
  name: string;
  updatedAt?: string;
  count: number;
};
