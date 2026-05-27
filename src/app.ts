import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { authRouter } from "./routes/routes.auth.js";
import { applicationRouter } from "./routes/routes.application.js";
import { profileRouter } from "./routes/routes.profile.js";
import { getRequestLogMeta, logger } from "./lib/logger.js";

const app = express();

app.use((req, res, next) => {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const meta = {
      ...getRequestLogMeta(req, res),
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    };

    if (res.statusCode >= 500) {
      logger.error("Request completed with server error", meta);
      return;
    }

    if (res.statusCode >= 400) {
      logger.warn("Request completed with client error", meta);
      return;
    }

    logger.info("Request completed", meta);
  });

  next();
});

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") || "http://localhost:3000",
    credentials: true,
  }),
);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/applications", applicationRouter);
app.use((req: Request, res: Response) => {
  logger.warn("Route not found", getRequestLogMeta(req, res));
  res.status(404).json({ message: "Not Found" });
});
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled route error", {
    ...getRequestLogMeta(req, res),
    error: err,
  });

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(500).json({ message: "Internal server error" });
});

export default app;
