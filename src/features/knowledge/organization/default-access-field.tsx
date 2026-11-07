'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './default-access-field.messages';
import type { TeamspaceAccess } from '../data/knowledge-catalog-client';
import { defaultAccessOptions } from './view-model';
import { PermissionSelect } from './permission-select';
import { cn } from '@/lib/utils';

export function DefaultAccessField({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: TeamspaceAccess;
  onChange: (value: TeamspaceAccess) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  const options = defaultAccessOptions(locale).map((option) => ({
    ...option,
    value: option.value ?? 'explicit',
  }));

  return (
    <div className={cn('mt-4', className)}>
      <PermissionSelect
        label={knowledgeT('defaultAccess')}
        value={value ?? 'explicit'}
        options={options}
        disabled={disabled}
        onChange={(next) =>
          onChange(
            defaultAccessOptions(locale).find((option) => (option.value ?? 'explicit') === next)!
              .value,
          )
        }
      />
    </div>
  );
}
