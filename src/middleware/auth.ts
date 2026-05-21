import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthedRequest = Request & { userId?: string };

export async function auth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ message: "Missing token" });
    }
    const secret = process.env.JWT_SECRET;
    if (!secret) {
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
    next();
  } catch (e) {
    console.error(`Error Message: ${e}`);
    return res.status(401).json({ message: "Invalid token" });
  }
}
