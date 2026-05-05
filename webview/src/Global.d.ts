import type { ExtensionToWebviewMessage } from "../../src/Types/SharedTypes";

interface VsCodeApi<TState> {
  getState(): TState | undefined;
  setState(state: TState): void;
  postMessage(message: unknown): void;
}

declare global {
  function acquireVsCodeApi<TState = unknown>(): VsCodeApi<TState>;

  interface WindowEventMap {
    message: MessageEvent<ExtensionToWebviewMessage>;
  }
}

export {};
