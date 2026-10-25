/** Bind a persisted thumbnail to its authoritative scene; external source edits invalidate it. */
export async function whiteboardSceneHash(scene: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scene));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
