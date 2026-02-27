import { type Request, type Response, type NextFunction } from "express";
import jwt from "jsonwebtoken";

export type AuthedRequest = Request & { userId?: string };

export async function auth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Missing token" });
    }
    const token = header.slice("Bearer ".length);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(401).json({ message: "Missing Secret" });
    }
    const payload = jwt.verify(token, secret) as { userId: string };

    req.userId = payload.userId;
    next();
  } catch (e) {
    console.error(`Error Message: ${e}`);
    return res.status(401).json({ message: "Invalid token" });
  }
}
