// Discord's gateway, used only to receive interactions: taps and pop-up submissions. The bot identifies with no
// intents at all, so it needs no privileged intent and never sees message content.
import { errorText, type Log } from '../log.ts';
import type { DiscordRest } from './rest.ts';

export interface Interaction {
  id: string;
  token: string;
  type: number;
  channel_id?: string;
  member?: { user?: { id: string } };
  user?: { id: string };
  data?: { custom_id?: string; component_type?: number };
  message?: { id: string };
}

interface Frame {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

const INTENTS = 0;
// Close codes after which reconnecting can't help: bad token, bad shard, bad or disallowed intents.
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

export class DiscordGateway {
  #rest: DiscordRest;
  #token: string;
  #log: Log;
  #onInteraction: (interaction: Interaction) => void;
  #socket: WebSocket | undefined;
  #heartbeat: NodeJS.Timeout | undefined;
  #firstBeat: NodeJS.Timeout | undefined;
  #reconnect: NodeJS.Timeout | undefined;
  #acked = true;
  #seq: number | null = null;
  #session: { id: string; resumeUrl: string } | undefined;
  #failures = 0;
  #stopped = false;

  constructor(options: { rest: DiscordRest; token: string; log: Log; onInteraction: (interaction: Interaction) => void }) {
    this.#rest = options.rest;
    this.#token = options.token;
    this.#log = options.log;
    this.#onInteraction = options.onInteraction;
  }

  /** Connects in the background and stays connected, resuming the session after a drop. */
  start(): void {
    void this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#firstBeat);
    clearInterval(this.#heartbeat);
    clearTimeout(this.#reconnect);
    this.#socket?.close(1000, 'shutting down');
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    try {
      const base = this.#session?.resumeUrl ?? (await this.#rest.gatewayUrl());
      const url = new URL(base);
      url.searchParams.set('v', '10');
      url.searchParams.set('encoding', 'json');
      const socket = new WebSocket(url);
      this.#socket = socket;
      socket.addEventListener('message', (event) => this.#receive(socket, JSON.parse(String(event.data)) as Frame));
      socket.addEventListener('close', (event) => this.#closed(socket, event.code));
    } catch (error) {
      this.#log('discord.gateway-unreachable', { error: errorText(error) });
      this.#scheduleReconnect();
    }
  }

  #send(socket: WebSocket, frame: { op: number; d: unknown }): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  #receive(socket: WebSocket, frame: Frame): void {
    if (typeof frame.s === 'number') this.#seq = frame.s;
    switch (frame.op) {
      case 10: {
        const interval = (frame.d as { heartbeat_interval: number }).heartbeat_interval;
        clearTimeout(this.#firstBeat);
        clearInterval(this.#heartbeat);
        this.#acked = true;
        this.#firstBeat = setTimeout(() => this.#beat(socket), Math.random() * interval);
        this.#heartbeat = setInterval(() => this.#beat(socket), interval);
        if (this.#session) {
          this.#send(socket, { op: 6, d: { token: this.#token, session_id: this.#session.id, seq: this.#seq } });
        } else {
          this.#send(socket, {
            op: 2,
            d: { token: this.#token, intents: INTENTS, properties: { os: 'linux', browser: 'lab1-assistant', device: 'lab1-assistant' } },
          });
        }
        return;
      }
      case 11:
        this.#acked = true;
        return;
      case 1:
        this.#send(socket, { op: 1, d: this.#seq });
        return;
      case 7:
        socket.close(4000, 'reconnect requested');
        return;
      case 9:
        if (!frame.d) this.#session = undefined;
        socket.close(4000, 'invalid session');
        return;
      case 0:
        if (frame.t === 'READY') {
          const ready = frame.d as { session_id: string; resume_gateway_url: string };
          this.#session = { id: ready.session_id, resumeUrl: ready.resume_gateway_url };
          this.#failures = 0;
          this.#log('discord.connected', {});
        }
        if (frame.t === 'RESUMED') this.#failures = 0;
        if (frame.t === 'INTERACTION_CREATE') this.#onInteraction(frame.d as Interaction);
        return;
    }
  }

  #beat(socket: WebSocket): void {
    if (socket !== this.#socket) return;
    if (!this.#acked) {
      socket.close(4000, 'no heartbeat ack');
      return;
    }
    this.#acked = false;
    this.#send(socket, { op: 1, d: this.#seq });
  }

  #closed(socket: WebSocket, code: number): void {
    if (socket !== this.#socket) return;
    clearTimeout(this.#firstBeat);
    clearInterval(this.#heartbeat);
    if (this.#stopped) return;
    if (FATAL_CLOSE_CODES.has(code)) {
      this.#log('discord.gateway-refused', { code });
      return;
    }
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#failures += 1;
    const delay = Math.min(1000 * 2 ** (this.#failures - 1), 60_000);
    this.#reconnect = setTimeout(() => void this.#connect(), delay);
  }
}
