import type { PanelClientState } from "../Types";

let cachedApi: ReturnType<typeof acquireVsCodeApi<PanelClientState>> | undefined;

export function UseVsCodeApi() {
  if (!cachedApi) {
    cachedApi = acquireVsCodeApi<PanelClientState>();
  }

  return cachedApi;
}
