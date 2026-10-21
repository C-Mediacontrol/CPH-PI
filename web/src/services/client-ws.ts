type EventHandler<T = any> = (payload: T) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private reconnectTimer: number | null = null;
  private backoffMs = 1000;
  private url: string;
  private isExplicitlyClosed = false;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (typeof window !== 'undefined' && window.location) {
      const loc = window.location;
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${protocol}//${loc.host}/ws`;
    } else {
      this.url = 'ws://127.0.0.1:5173/ws';
    }
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isExplicitlyClosed = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('[WsClient] Failed to initialize WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.backoffMs = 1000;
      this.emit('connection:change', { connected: true });
    };

    this.ws.onclose = () => {
      this.emit('connection:change', { connected: false });
      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event) => {
      console.warn('[WsClient] WebSocket error:', event);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet && typeof packet.type === 'string') {
          this.emit(packet.type, packet.payload);
        }
      } catch (e) {
        console.error('[WsClient] Failed to parse WS packet:', e);
      }
    };
  }

  public disconnect(): void {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.emit('connection:change', { connected: false });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.isExplicitlyClosed) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, 10000);
      this.connect();
    }, this.backoffMs);
  }

  public on<T = any>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
    return () => {
      this.handlers.get(event)?.delete(handler as EventHandler);
    };
  }

  public send(type: string, payload: unknown = {}): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn(`[WsClient] Cannot send message '${type}': WebSocket is not open.`);
    }
  }

  private emit(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const h of set) {
        try {
          h(payload);
        } catch (err) {
          console.error(`[WsClient] Error in handler for '${event}':`, err);
        }
      }
    }
  }
}

export const wsClient = new WsClient();
