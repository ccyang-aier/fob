import { SkillLayers, type IconProps } from '@/components/icons';

export function SkillIcon({ size = 16, ...props }: IconProps) {
  return <SkillLayers size={size} {...props} />;
}
