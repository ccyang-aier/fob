import { pushWorkbenchLocation } from '@/lib/navigation-history';

export function openPersonalProfile() {
  const url = new URL(window.location.href);
  for (const key of ['tab', 'document', 'folder', 'comment', 'block', 'returnView', 'section']) url.searchParams.delete(key);
  url.searchParams.set('view', 'profile');
  if (url.href !== window.location.href) pushWorkbenchLocation(url);
}
