import { User } from "../models/userModel.js";
import { type Request, type Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Profile } from "../models/profileModel.js";
import { getRequestLogMeta, logger } from "../lib/logger.js";

function maskEmail(email: string) {
  const [localPart = "", domain = ""] = email.split("@");
  const maskedLocalPart =
    localPart.length <= 2
      ? `${localPart.charAt(0)}*`
      : `${localPart.slice(0, 2)}***`;

  return domain ? `${maskedLocalPart}@${domain}` : maskedLocalPart;
}

export async function checkAuth(req: Request, res: Response) {
  try {
    const token = req.cookies.token;
    if (!token) {
      logger.warn("Auth check failed: missing token", getRequestLogMeta(req, res));
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "") as {
      userId: string;
    };
    const user = await User.findById(decoded.userId);
    if (!user) {
      logger.warn("Auth check failed: user not found", {
        ...getRequestLogMeta(req, res),
        userId: decoded.userId,
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    logger.info("Auth check succeeded", {
      ...getRequestLogMeta(req, res),
      userId: user._id.toString(),
    });

    return res.status(200).json({ user: { id: user._id, email: user.email } });
  } catch (e) {
    logger.error("Auth check failed", {
      ...getRequestLogMeta(req, res),
      error: e,
    });
    return res.status(500).json({ message: "Auth Check Failed" });
  }
}

export async function register(req: Request, res: Response) {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and Password are required" });

    const exist = await User.findOne({ email });
    if (exist) {
      logger.warn("Registration rejected: email already in use", {
        ...getRequestLogMeta(req, res),
        email: maskEmail(email),
      });
      return res.status(409).json({ message: "Email is already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });
    try {
      await Profile.create({ userId: user._id });
    } catch (profileError) {
      await User.findByIdAndDelete(user._id);
      throw profileError;
    }
    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET || "",
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    logger.info("User registered", {
      ...getRequestLogMeta(req, res),
      userId: user._id.toString(),
      email: maskEmail(user.email),
    });

    return res.status(201).json({
      token,
      user: { id: user._id, email: user.email },
      message: "User Succesfully Registered",
    });
  } catch (e) {
    logger.error("Registration failed", {
      ...getRequestLogMeta(req, res),
      error: e,
    });
    return res.status(500).json({ message: "Signup Failed" });
  }
}

export async function login(req: Request, res: Response) {
  try {
    // Request Info from the user
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      logger.warn("Login rejected: missing credentials", getRequestLogMeta(req, res));
      return res
        .status(400)
        .json({ message: "Email and Password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      logger.warn("Login rejected: user not found", {
        ...getRequestLogMeta(req, res),
        email: maskEmail(email),
      });
      return res.status(401).json({ message: "Email not found Try Register" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      logger.warn("Login rejected: invalid credentials", {
        ...getRequestLogMeta(req, res),
        userId: user._id.toString(),
        email: maskEmail(user.email),
      });
      return res.status(401).json({ message: "Invalid Credentials" });
    }

    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET || "",
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    logger.info("User logged in", {
      ...getRequestLogMeta(req, res),
      userId: user._id.toString(),
      email: maskEmail(user.email),
    });

    return res.status(201).json({
      token,
      user: { id: user._id, email: user.email },
      message: "Login Succesful",
    });
  } catch (e) {
    logger.error("Login failed", {
      ...getRequestLogMeta(req, res),
      error: e,
    });
    return res.status(500).json({ message: "Login Failed" });
  }
}

export async function logout(req: Request, res: Response) {
  try {
    res.clearCookie("token");
    logger.info("User logged out", getRequestLogMeta(req, res));
    return res.status(201).json({ message: "Logout Succesfully" });
  } catch (e) {
    logger.error("Logout failed", {
      ...getRequestLogMeta(req, res),
      error: e,
    });
    return res.status(500).json({ message: "Logout failed" });
  }
}
