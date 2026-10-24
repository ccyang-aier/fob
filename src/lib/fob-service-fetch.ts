/** Fob runs in the browser and uses its own HTTP session cookies. */
export const fobServiceFetch: typeof fetch = (input, init) => fetch(input, init);
