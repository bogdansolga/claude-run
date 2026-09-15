import { query as sdkQuery, type Options } from "@anthropic-ai/claude-agent-sdk";

import type { SdkMessage, SdkQuery } from "./sdk-driver.js";

export function createSdkQuery(): SdkQuery {
  return ({ prompt, options }) => {
    const { abortController, ...sdkOptions } = options as Options & { abortController?: AbortController };
    return (async function* () {
      for await (const message of sdkQuery({
        prompt,
        options: {
          ...sdkOptions,
          abortController,
        },
      })) {
        yield message as unknown as SdkMessage;
      }
    })();
  };
}
