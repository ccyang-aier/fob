/** Browser WebSocket transport; the service still validates socket tickets. */
export function getFobServiceWebSocket(): typeof WebSocket {
  return WebSocket;
}
