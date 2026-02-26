import { EventEmitter } from "events";

export const craftsmanEvents = new EventEmitter();
craftsmanEvents.setMaxListeners(200);

export function emitStatusChange(
  craftsmanId: string,
  status: string,
  extra: Record<string, unknown> = {}
): void {
  craftsmanEvents.emit(`craftsman:${craftsmanId}`, { status, ...extra });
}
