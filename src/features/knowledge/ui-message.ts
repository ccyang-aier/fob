'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation, type MessageCatalog, type MessageValues } from '@/lib/i18n';

export interface KnowledgeUiMessage<Catalog extends MessageCatalog> {
  key: keyof Catalog & string;
  values?: MessageValues;
}

type StoredMessage<Catalog extends MessageCatalog> = string | null | KnowledgeUiMessage<Catalog>;
type MessageSetter<Catalog extends MessageCatalog> = Dispatch<
  SetStateAction<StoredMessage<Catalog>>
>;

export function useUiMessage<Catalog extends MessageCatalog>(
  catalog: Catalog,
  initial: null,
): readonly [string | null, MessageSetter<Catalog>];
export function useUiMessage<Catalog extends MessageCatalog>(
  catalog: Catalog,
  initial: string,
): readonly [string, MessageSetter<Catalog>];
export function useUiMessage<Catalog extends MessageCatalog>(
  catalog: Catalog,
  initial: string | null,
) {
  const [message, setMessage] = useState<StoredMessage<Catalog>>(initial);
  const { t } = useTranslation(catalog);
  // App messages store explicit keys. External service and user text stay verbatim.
  const text =
    message !== null && typeof message === 'object' ? t(message.key, message.values) : message;
  return [text, setMessage] as const;
}
