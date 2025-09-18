declare module "next/dist/compiled/https-proxy-agent" {
  import type { AgentOptions } from "node:https";
  import { Agent as HttpsAgent } from "node:https";

  export class HttpsProxyAgent extends HttpsAgent {
    constructor(proxyUrl: string, opts?: AgentOptions);
  }
}
