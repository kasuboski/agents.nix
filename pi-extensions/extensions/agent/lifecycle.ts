import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export async function hasAgentSettled(settledFile: string): Promise<boolean> {
  try {
    await fs.promises.access(settledFile);
    return true;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  const settledFile = process.env.PI_AGENT_SETTLED_FILE;
  const settledSessionId = process.env.PI_AGENT_SETTLED_SESSION_ID;
  if (!settledFile || !settledSessionId) return;

  pi.on("agent_settled", async (_event, ctx) => {
    // Nested subagents inherit the env, so only signal for the named session.
    if (ctx.sessionManager.getSessionId() !== settledSessionId) return;
    await fs.promises.writeFile(settledFile, "settled\n", {
      encoding: "utf8",
      mode: 0o600,
    });
  });
}
