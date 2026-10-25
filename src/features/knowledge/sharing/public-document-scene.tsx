'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { publicDocumentSchema } from '@fob/shared/knowledge/contracts';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { useTranslation } from '@/lib/i18n';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { renderCheckpointHtml } from '../history/restore';
import { messages } from './collaboration.messages';
import styles from './document-collaboration.module.css';

export function PublicDocumentScene() {
  const { t, locale } = useTranslation(messages);
  const [state, setState] = useState<{ title: string; html: string; updatedAt: string } | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [downloading, setDownloading] = useState(false);
  const location = useRef<{ token: string; origin: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let urls: string[] = [];
    let running = false;
    async function load() {
      if (running || controller.signal.aborted) return;
      running = true;
      const nextUrls: string[] = [];
      try {
        const token = decodeURIComponent(window.location.hash.slice(1));
        const { origin } = await getFobApiOrigin(); location.current = { token, origin };
        const response = await fetch(`${origin}/api/public/documents`, { method: 'POST', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        if (!response.ok) throw new Error(response.status === 404 ? t('unavailable') : t('failed'));
        const document = publicDocumentSchema.parse(await response.json());
        const host = window.document.createElement('div'); host.innerHTML = renderCheckpointHtml(document.body, knowledgeSchema) ?? '';
        const media = [...host.querySelectorAll<HTMLElement>('[src^="asset:"]')];
        const resolved = new Map<string, Promise<string>>();
        const mediaResults = await Promise.allSettled(media.map(async element => {
          const hash = element.getAttribute('src')!.slice(6);
          if (!document.assets[hash]) { element.removeAttribute('src'); return; }
          if (!resolved.has(hash)) resolved.set(hash, (async () => {
            const asset = await fetch(`${origin}/api/public/documents/assets/${hash}`, { method: 'POST', credentials: 'omit', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
            if (!asset.ok) throw new Error(t('failed'));
            const url = URL.createObjectURL(await asset.blob()); nextUrls.push(url); return url;
          })());
          element.setAttribute('src', await resolved.get(hash)!);
        }));
        const failedMedia = mediaResults.find(result => result.status === 'rejected');
        if (failedMedia?.status === 'rejected') throw failedMedia.reason;
        for (const element of host.querySelectorAll<HTMLElement>('[data-file]')) {
          const source = element.getAttribute('data-file') ?? '';
          const anchor = window.document.createElement('a'); anchor.textContent = element.textContent; anchor.href = '#';
          if (source.startsWith('asset:') && document.assets[source.slice(6)]) anchor.dataset.downloadAsset = source.slice(6);
          else if (/^https?:\/\//.test(source)) { anchor.href = source; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
          element.replaceWith(anchor);
        }
        for (const anchor of host.querySelectorAll('a[href]')) { anchor.setAttribute('rel', 'noopener noreferrer'); }
        if (controller.signal.aborted) { for (const url of nextUrls) URL.revokeObjectURL(url); return; }
        setState({ title: document.title, html: host.innerHTML, updatedAt: document.updatedAt }); setError('');
        for (const previous of urls) URL.revokeObjectURL(previous);
        urls = nextUrls;
      } catch (cause) {
        for (const url of [...urls, ...nextUrls]) URL.revokeObjectURL(url);
        urls = [];
        if (!controller.signal.aborted) { setState(null); setError(cause instanceof Error ? cause.message : t('failed')); }
      }
      finally { running = false; }
    }
    void load();
    const timer = setInterval(() => { if (window.document.visibilityState === 'visible') void load(); }, 30_000);
    window.addEventListener('focus', load);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', load); for (const url of urls) URL.revokeObjectURL(url); };
  }, [attempt, t]);
  async function download(hash: string, name: string) {
    if (!location.current || downloading) return;
    setDownloading(true);
    try {
      const { origin, token } = location.current;
      const response = await fetch(`${origin}/api/public/documents/assets/${hash}`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (!response.ok) throw new Error(t('unavailable'));
      const url = URL.createObjectURL(await response.blob()), link = window.document.createElement('a');
      link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
    finally { setDownloading(false); }
  }
  return <main className={`${styles.surface} ${styles.public}`}><header><strong>Fob</strong><Link href="/">{t('openFob')}</Link></header>
    {error && <div className={styles.state}><AppAlert tone="error" title={error} /><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button></div>}
    {state ? <article><h1>{state.title || t('unnamed')}</h1><time dateTime={state.updatedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(state.updatedAt))}</time>
      <div className={styles.publicBody} aria-busy={downloading} onClick={event => {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-download-asset]');
        if (link) { event.preventDefault(); void download(link.dataset.downloadAsset!, link.textContent ?? 'download'); }
      }} dangerouslySetInnerHTML={{ __html: state.html }} /></article> : !error && <p className={styles.empty} role="status">{t('loading')}</p>}
  </main>;
}
