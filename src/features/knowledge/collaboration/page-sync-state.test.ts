import { describe, expect, test } from 'bun:test';
import { initialPageDocumentStatus, reducePageDocumentStatus } from './page-sync-state';

const localLoaded = { type: 'local-loaded' } as const;
const connectStarted = { type: 'connect-started' } as const;
const syncComplete = { type: 'sync-complete' } as const;
const connectionLost = { type: 'connection-lost' } as const;
const localEdit = { type: 'local-edit' } as const;

describe('page document status machine', () => {
  test('starts local-only with neither local copy nor pending cloud edits', () => {
    expect(initialPageDocumentStatus).toEqual({ phase: 'local-only', localReady: false, cloudPending: false });
  });

  test('the local copy loads while still local-only; edits made there await the cloud', () => {
    const loaded = reducePageDocumentStatus(initialPageDocumentStatus, localLoaded);
    expect(loaded).toEqual({ phase: 'local-only', localReady: true, cloudPending: false });
    const edited = reducePageDocumentStatus(loaded, localEdit);
    expect(edited).toEqual({ phase: 'local-only', localReady: true, cloudPending: true });
  });

  test('connects, syncs, and clears the pending flag once the server acknowledges', () => {
    let status = reducePageDocumentStatus(initialPageDocumentStatus, localLoaded);
    status = reducePageDocumentStatus(status, localEdit);
    status = reducePageDocumentStatus(status, connectStarted);
    expect(status).toEqual({ phase: 'syncing', localReady: true, cloudPending: true });
    status = reducePageDocumentStatus(status, syncComplete);
    expect(status).toEqual({ phase: 'synced', localReady: true, cloudPending: false });
    // Live edits ride the open socket: no pending state while synced.
    expect(reducePageDocumentStatus(status, localEdit)).toBe(status);
  });

  test('a drop moves synced work offline; edits there stay visibly unsynced until resync', () => {
    let status = reducePageDocumentStatus(reducePageDocumentStatus(initialPageDocumentStatus, localLoaded), syncComplete);
    status = reducePageDocumentStatus(status, connectionLost);
    expect(status.phase).toBe('offline');
    status = reducePageDocumentStatus(status, localEdit);
    expect(status.cloudPending).toBe(true);
    status = reducePageDocumentStatus(status, connectStarted);
    expect(status).toEqual({ phase: 'syncing', localReady: true, cloudPending: true });
    status = reducePageDocumentStatus(status, syncComplete);
    expect(status).toEqual({ phase: 'synced', localReady: true, cloudPending: false });
  });

  test('a failed first connection lands in offline, not error; local-only ignores drops', () => {
    const attempted = reducePageDocumentStatus(initialPageDocumentStatus, connectStarted);
    expect(reducePageDocumentStatus(attempted, connectionLost).phase).toBe('offline');
    expect(reducePageDocumentStatus(initialPageDocumentStatus, connectionLost)).toBe(initialPageDocumentStatus);
  });

  test('authentication failure is terminal; local edits during it stay pending', () => {
    let status = reducePageDocumentStatus(initialPageDocumentStatus, connectStarted);
    status = reducePageDocumentStatus(status, { type: 'auth-failed', reason: 'permission-denied' });
    expect(status).toEqual({ phase: 'error', localReady: false, cloudPending: false, errorReason: 'permission-denied' });
    expect(reducePageDocumentStatus(status, connectStarted)).toBe(status);
    expect(reducePageDocumentStatus(status, syncComplete)).toBe(status);
    expect(reducePageDocumentStatus(status, connectionLost)).toBe(status);
    const edited = reducePageDocumentStatus(status, localEdit);
    expect(edited.cloudPending).toBe(true);
  });

  test('repeated events return the same status object instead of new copies', () => {
    const once = reducePageDocumentStatus(initialPageDocumentStatus, localLoaded);
    expect(reducePageDocumentStatus(once, localLoaded)).toBe(once);
    expect(reducePageDocumentStatus(once, connectStarted)).not.toBe(once);
  });
});
