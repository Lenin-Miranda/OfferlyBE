import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getRequestLogMeta, logger } from "../lib/logger.js";

export type AuthedRequest = Request & { userId?: string };

export async function auth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies.token;
    if (!token) {
      logger.warn("Authentication failed: missing token", getRequestLogMeta(req, res));
      return res.status(401).json({ message: "Missing token" });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error("Authentication failed: missing JWT secret", getRequestLogMeta(req, res));
      return res.status(401).json({ message: "Missing Secret" });
    }
    const payload = jwt.verify(token, secret) as { userId: string };

    req.userId = payload.userId;
    if (
      process.env.LOG_APPLICATION_PATCH_TIMINGS === "true" &&
      req.method === "PATCH" &&
      req.originalUrl.includes("/api/applications/")
    ) {
      res.locals.authCompletedAtNs = process.hrtime.bigint();
    }
    logger.info("Authentication succeeded", {
      ...getRequestLogMeta(req, res),
      userId: payload.userId,
    });
    next();
  } catch (e) {
    logger.warn("Authentication failed: invalid token", {
      ...getRequestLogMeta(req, res),
      error: e,
    });
    return res.status(401).json({ message: "Invalid token" });
  }
}
