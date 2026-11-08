/** Explicit product reset: retire browser content without importing it into user folders. */
export async function clearRetiredBrowserLibraries() {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key === 'fob.local-library' || key === 'fob.local-templates' || key.startsWith('fob.learning.v1.') || key.startsWith('fob.folder.overview-draft:local:')) window.localStorage.removeItem(key);
    }
  } catch (cause) {
    // A browser which disables site storage must still be able to use a chosen disk folder.
    if (!(cause instanceof DOMException) || cause.name !== 'SecurityError') throw cause;
  }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('fob-local-assets');
    request.onsuccess = () => resolve();
    request.onerror = () => request.error?.name === 'SecurityError' ? resolve() : reject(request.error);
    request.onblocked = () => reject(new Error('Close other Fob windows to remove retired browser assets.'));
  }).catch(cause => { if (!(cause instanceof DOMException) || cause.name !== 'SecurityError') throw cause; });
}
