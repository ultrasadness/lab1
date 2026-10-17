// The bot's log: one JSON line per event on stdout, which the journal keeps. Never log a token or a model input.
import type { Clock } from './clock.ts';

export interface LogEntry {
  at: string;
  event: string;
  [field: string]: unknown;
}

export type LogSink = (entry: LogEntry) => void;

export const stdoutSink: LogSink = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

export type Log = (event: string, fields?: Record<string, unknown>) => void;

export function createLog(sink: LogSink, clock: Clock): Log {
  return (event, fields = {}) => sink({ at: clock.now().toISOString(), event, ...fields });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
