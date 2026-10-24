'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './comment-markdown.messages';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeKnowledgeUrl } from '@fob/shared/knowledge/schema';
import { knowledgeAssetsApi } from '../../assets/assets-api';
import styles from './comments.module.css';

export function CommentImage({
  source,
  alt,
  knowledgeBaseId,
}: {
  source: string;
  alt: string;
  knowledgeBaseId: string;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const safe = safeKnowledgeUrl(source, 'media');
  const hash = safe?.startsWith('asset:') ? safe.slice(6) : null;
  const grant = useQuery({
    queryKey: ['knowledge', knowledgeBaseId, 'comment-image', hash],
    enabled: !!hash && !!knowledgeBaseId,
    queryFn: ({ signal }) => knowledgeAssetsApi.download(knowledgeBaseId, hash!, signal),
    refetchInterval: (query) =>
      query.state.data
        ? Math.max(10_000, Date.parse(query.state.data.expiresAt) - Date.now() - 60_000)
        : false,
    retry: false,
  });
  const url = hash ? grant.data?.url : safe;
  if (!safe)
    return (
      <span className={styles.imageStatus} role="alert">
        {knowledgeT('invalidImageAddress')}
      </span>
    );
  if (hash && !knowledgeBaseId)
    return (
      <span className={styles.imageStatus} role="alert">
        {knowledgeT('imageIsNotAssociatedWithAKnowledgeBase')}
      </span>
    );
  if (url && failedUrl === url)
    return (
      <span className={styles.imageStatus} role="alert">
        {knowledgeT('unableToLoadImage')}
        <button
          type="button"
          onClick={() => {
            setFailedUrl(null);
            if (hash) void grant.refetch();
          }}
        >
          {knowledgeT('retry')}
        </button>
      </span>
    );
  if (!url)
    return (
      <span className={styles.imageStatus} role={grant.isError ? 'alert' : 'status'}>
        {grant.isError ? knowledgeT('unableToLoadImage') : knowledgeT('loadingImage')}
        {grant.isError && (
          <button type="button" onClick={() => void grant.refetch()}>
            {knowledgeT('retry')}
          </button>
        )}
      </span>
    );
  // Authorized asset URLs and user images bypass the Next image proxy.
  return (
    // eslint-disable-next-line @next/next/no-img-element -- User asset URLs bypass the image proxy.
    <img
      className={styles.commentImage}
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  );
}

export function CommentMarkdown({
  body,
  knowledgeBaseId,
}: {
  body: string;
  knowledgeBaseId: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url, key) => safeKnowledgeUrl(url, key === 'src' ? 'media' : 'link') ?? ''}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        img: ({ src, alt }) =>
          typeof src === 'string' ? (
            <CommentImage source={src} alt={alt ?? ''} knowledgeBaseId={knowledgeBaseId} />
          ) : null,
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
