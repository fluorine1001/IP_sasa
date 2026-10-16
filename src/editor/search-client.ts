import type { Stage } from '../world/types';
import type { SearchReport, SearchTemplate } from './solution-search';

export type SearchRequest = {
  revision: number;
  stage?: Stage;
  templates?: SearchTemplate[];
  budget?: number;
  global?: boolean;
  maxCommands?: number;
  continue?: boolean;
  extraBudget?: number;
  continuous?: boolean;
  pause?: boolean;
  ack?: boolean;
};
export type SearchFault = {
  phase: 'startup' | 'runtime' | 'message' | 'input';
  message: string;
  name?: string;
};
export type SearchResponse = {
  revision: number;
  result?: SearchReport;
  ready?: boolean;
  fault?: SearchFault;
};
type Port = {
  postMessage(message: SearchRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SearchResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
};

/** Own one worker generation. A stale error can never stop a newer search.
 * Retry a transient startup ONCE; a failed computation stops with its last
 * result intact, not a silently restarted enumeration or fabricated completion. */
export class SearchClient {
  private port?: Port;
  private generation = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private ready = false;
  private received = false;
  private request?: SearchRequest;
  constructor(
    private create: () => Port,
    private callbacks: {
      result: (report: SearchReport) => void;
      fault: (fault: SearchFault) => void;
      recovering?: () => void;
    },
  ) {}
  get active() {
    return !!this.port || this.retry !== undefined;
  }
  start(request: SearchRequest) {
    this.dispose();
    this.request = request;
    this.retries = 0;
    this.ready = this.received = false;
    this.connect(this.generation);
  }
  private connect(generation: number) {
    if (generation !== this.generation || !this.request) return;
    try {
      const port = this.create();
      this.port = port;
      port.onmessage = (event) => {
        if (
          generation !== this.generation ||
          port !== this.port ||
          !event.data ||
          event.data.revision !== this.request?.revision
        )
          return;
        if (event.data.ready) this.ready = true;
        if (event.data.fault) {
          this.failed(generation, event.data.fault, false);
          return;
        }
        if (event.data.result) {
          this.received = true;
          const revision = this.request.revision;
          try {
            this.callbacks.result(event.data.result);
          } catch (error) {
            this.failed(
              generation,
              { phase: 'message', message: error instanceof Error ? error.message : String(error) },
              false,
            );
          } finally {
            this.postMessage({ revision, ack: true });
          }
        }
      };
      port.onerror = (event) => {
        event.preventDefault();
        if (port !== this.port) return;
        this.failed(
          generation,
          {
            phase: this.ready || this.received ? 'runtime' : 'startup',
            message: event.message || '작업자 실행이 중단되었습니다.',
          },
          !this.ready && !this.received,
        );
      };
      port.onmessageerror = () => {
        if (port === this.port)
          this.failed(
            generation,
            { phase: 'message', message: '탐색 결과를 전달하지 못했습니다.' },
            false,
          );
      };
      port.postMessage(this.request);
    } catch (error) {
      this.failed(
        generation,
        { phase: 'startup', message: error instanceof Error ? error.message : String(error) },
        true,
      );
    }
  }
  private failed(generation: number, fault: SearchFault, retryable: boolean) {
    if (generation !== this.generation) return;
    this.port?.terminate();
    this.port = undefined;
    if (retryable && this.retries++ === 0) {
      this.callbacks.recovering?.();
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.connect(generation);
      }, 250);
    } else this.callbacks.fault({ ...fault, message: fault.message.slice(0, 300) });
  }
  postMessage(message: SearchRequest) {
    if (!this.port || message.revision !== this.request?.revision) return;
    try {
      this.port.postMessage(message);
    } catch (error) {
      this.failed(
        this.generation,
        { phase: 'message', message: error instanceof Error ? error.message : String(error) },
        false,
      );
    }
  }
  dispose() {
    this.generation++;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.port?.terminate();
    this.port = undefined;
    this.request = undefined;
  }
  terminate() {
    this.dispose();
  }
}
