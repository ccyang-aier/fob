const OPEN_COMPANION_EVENT = 'fob:companion:open';

/** Any client feature can summon the single application companion. */
export function openCompanion() { window.dispatchEvent(new Event(OPEN_COMPANION_EVENT)); }
export { OPEN_COMPANION_EVENT };
