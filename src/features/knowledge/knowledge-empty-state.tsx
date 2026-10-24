'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './knowledge-empty-state.messages';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { FileText, Lightning, MagnifyingGlass, Plus, Question } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { NavigationDialogPortal } from './navigation/navigation-dialog-portal';
import { DialogButton, ModalDialog } from './organization/ui';
import styles from './knowledge-empty-state.module.css';

export function KnowledgeEmptyState({ onCreate }: { onCreate: () => void }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [helpOpen, setHelpOpen] = useState(false);
  const learnButton = useRef<HTMLButtonElement>(null);
  function closeHelp() {
    setHelpOpen(false);
    learnButton.current?.focus();
  }

  return (
    <section className={styles.surface} aria-labelledby="knowledge-empty-title">
      <div className={styles.content}>
        <Image
          src="/illustrations/knowledge-empty.png"
          alt=""
          width={1706}
          height={922}
          className={styles.illustration}
          preload
        />
        <h1 id="knowledge-empty-title" className={styles.title}>
          {knowledgeT('startWithYourFirstIdea')}
        </h1>
        <p className={styles.description}>
          {knowledgeT('createAKnowledgeBaseForYourResourcesAnd')}
        </p>
        <div className={styles.actions}>
          <Button onClick={onCreate} className={styles.create}>
            <Plus size={18} aria-hidden />
            {knowledgeT('newKnowledgeBase')}
          </Button>
          <Button
            ref={learnButton}
            variant="ghost"
            onClick={() => setHelpOpen(true)}
            className={styles.learn}
          >
            <Question size={20} aria-hidden />
            {knowledgeT('aboutKnowledgeBases')}
          </Button>
        </div>
        <div className={styles.benefits}>
          <div aria-hidden className={styles.divider}>
            <hr />
          </div>
          <ul className={styles.benefitList}>
            <li>
              <FileText size={20} aria-hidden />
              {knowledgeT('organizedResources')}
            </li>
            <li>
              <Lightning size={20} aria-hidden />
              {knowledgeT('ideasPreserved')}
            </li>
            <li>
              <MagnifyingGlass size={20} aria-hidden />
              {knowledgeT('alwaysEasyToFind')}
            </li>
          </ul>
        </div>
      </div>
      {helpOpen ? (
        <NavigationDialogPortal>
          <ModalDialog
            open
            title={knowledgeT('aboutKnowledgeBases')}
            description={knowledgeT('organizeDocumentsResourcesAndIdeasWithFoldersAnd')}
            onClose={closeHelp}
            footer={
              <>
                <DialogButton autoFocus onClick={closeHelp}>
                  {knowledgeT('gotIt')}
                </DialogButton>
                <DialogButton
                  variant="primary"
                  onClick={() => {
                    setHelpOpen(false);
                    onCreate();
                  }}
                >
                  {knowledgeT('newKnowledgeBase')}
                </DialogButton>
              </>
            }
          >
            <dl className={styles.help}>
              <div>
                <dt>{knowledgeT('localKnowledgeBase')}</dt>
                <dd>{knowledgeT('storedInThisBrowserForPersonalUseSigning')}</dd>
              </div>
              <div>
                <dt>{knowledgeT('serverKnowledgeBase')}</dt>
                <dd>{knowledgeT('createOneAfterSigningInThenShareAnd')}</dd>
              </div>
            </dl>
          </ModalDialog>
        </NavigationDialogPortal>
      ) : null}
    </section>
  );
}
