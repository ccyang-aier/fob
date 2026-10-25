import type { IconProps } from '@/components/icons';
import { getProjectIconDefinition } from './project-icons';
import { cn } from '@/lib/utils';

export type ProjectIconProps = IconProps & { iconId?: string; alt?: string };

export function ProjectIcon({ iconId, alt = '', className, ...props }: ProjectIconProps) {
  const definition = getProjectIconDefinition(iconId);
  const Glyph = definition.icon;
  return <Glyph aria-hidden={alt ? undefined : true} aria-label={alt || undefined}
    data-project-icon={definition.id} className={cn('block shrink-0 select-none', className)} {...props} />;
}
