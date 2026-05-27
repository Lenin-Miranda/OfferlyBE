import { type Request, type Response } from "express";

type LogLevel = "INFO" | "WARN" | "ERROR";
const isTestEnv = process.env.NODE_ENV === "test";

function serializeMeta(meta: unknown) {
  return JSON.stringify(
    meta,
    (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }

      if (typeof value === "bigint") {
        return value.toString();
      }

      return value;
    },
  );
}

function writeLog(level: LogLevel, message: string, meta?: unknown) {
  if (isTestEnv) {
    return;
  }

  const parts = [`[${new Date().toISOString()}]`, `[${level}]`, message];

  if (meta !== undefined) {
    parts.push(serializeMeta(meta));
  }

  const line = parts.join(" ");

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info(message: string, meta?: unknown) {
    writeLog("INFO", message, meta);
  },
  warn(message: string, meta?: unknown) {
    writeLog("WARN", message, meta);
  },
  error(message: string, meta?: unknown) {
    writeLog("ERROR", message, meta);
  },
};

export function getRequestLogMeta(req: Request, res?: Response) {
  return {
    requestId:
      typeof res?.locals.requestId === "string" ? res.locals.requestId : null,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  };
}
