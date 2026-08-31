import { nanoid } from "nanoid";
import type { QmeStore } from "./db.js";
import type { QmeEvent } from "./types.js";

interface EventSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  on(event: "message", listener: (data: { toString(): string }) => void): void;
  on(event: "close", listener: () => void): void;
}

interface ClientSubscription {
  jobId?: string;
  queue?: string;
}

interface Client {
  socket: EventSocket;
  subscription: ClientSubscription;
}

export class EventBus {
  private readonly clients = new Set<Client>();

  constructor(private readonly store: QmeStore) {}

  addClient(socket: EventSocket): void {
    const client: Client = { socket, subscription: {} };
    this.clients.add(client);
    socket.send(JSON.stringify({ type: "hello", version: 1 }));
    socket.on("message", (data) => this.handleClientMessage(client, data));
    socket.on("close", () => this.clients.delete(client));
  }

  emit(input: Omit<QmeEvent, "id" | "at">): QmeEvent {
    const event: QmeEvent = {
      ...input,
      id: `evt_${nanoid()}`,
      at: new Date().toISOString()
    };
    this.store.appendEvent(event);
    const encoded = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.socket.readyState !== client.socket.OPEN) continue;
      if (!matches(client.subscription, event)) continue;
      client.socket.send(encoded);
    }
    return event;
  }

  private handleClientMessage(client: Client, data: { toString(): string }): void {
    try {
      const parsed = JSON.parse(data.toString()) as { type?: string; jobId?: string; queue?: string };
      if (parsed.type === "subscribe") {
        client.subscription = {
          jobId: parsed.jobId,
          queue: parsed.queue
        };
        client.socket.send(JSON.stringify({ type: "subscribed", subscription: client.subscription }));
      }
    } catch {
      client.socket.send(JSON.stringify({ type: "error", message: "Invalid WebSocket message" }));
    }
  }
}

function matches(subscription: ClientSubscription, event: QmeEvent): boolean {
  if (subscription.jobId && event.jobId !== subscription.jobId) return false;
  if (subscription.queue && event.queue !== subscription.queue) return false;
  return true;
}
