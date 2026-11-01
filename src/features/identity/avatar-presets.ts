export const avatarFamilies = ['pets','sketches','landscapes'] as const;
export type AvatarFamily = typeof avatarFamilies[number];
export const avatarPresets = avatarFamilies.flatMap(family => Array.from({ length: 8 },(_,index) => ({
  id: `${family}-${String(index+1).padStart(2,'0')}`, family, number: index+1,
  image: `/avatars/v1/${family}-${String(index+1).padStart(2,'0')}.webp`,
})));
