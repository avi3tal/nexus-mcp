#!/usr/bin/env node

import { resolve, dirname } from "path";
import { spawnPromise } from "spawn-rx";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms, true));
}

async function main() {
  const args = process.argv.slice(2);
  const envVars = {};
  const serverArgs = [];
  let command = null;
  let parsingFlags = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (parsingFlags && arg === "--") {
      parsingFlags = false;
      continue;
    }

    if (parsingFlags && arg === "-e" && i + 1 < args.length) {
      const envVar = args[++i];
      const equalsIndex = envVar.indexOf("=");

      if (equalsIndex !== -1) {
        const key = envVar.substring(0, equalsIndex);
        const value = envVar.substring(equalsIndex + 1);
        envVars[key] = value;
      } else {
        envVars[envVar] = "";
      }
    } else if (!command) {
      command = arg;
    } else {
      serverArgs.push(arg);
    }
  }

  const serverPath = resolve(__dirname, "..", "server", "build", "index.js");
  const SERVER_PORT = process.env.SERVER_PORT ?? "3000";

  console.log("Starting Nexus MCP server...");

  const abort = new AbortController();
  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    abort.abort();
  });

  try {
    await spawnPromise(
      "node",
      [
        serverPath,
        ...(command ? [`--env`, command] : []),
        ...(serverArgs ? [`--args=${serverArgs.join(" ")}`] : []),
      ],
      {
        env: {
          ...process.env,
          PORT: SERVER_PORT,
          MCP_ENV_VARS: JSON.stringify(envVars),
        },
        signal: abort.signal,
        echoOutput: true,
      }
    );
  } catch (e) {
    if (!cancelled || process.env.DEBUG) throw e;
  }

  return 0;
}

main()
  .then((_) => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  }); 