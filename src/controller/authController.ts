import { User } from "../models/userModel.js";
import { type Request, type Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

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
    if (exist)
      return res.status(409).json({ message: "Email is already in use" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });
    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET || "",
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });

    return res.status(201).json({
      token,
      user: { id: user._id, email: user.email },
      message: "User Succesfully Registered",
    });
  } catch (e) {
    console.error(`Error Message: ${e}`);
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

    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and Password are required" });

    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ message: "Email not found Try Register" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid Credentials" });

    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET || "",
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });

    return res.status(201).json({
      token,
      user: { id: user._id, email: user.email },
      message: "Login Succesful",
    });
  } catch (e) {
    console.error(`Error Message: ${e}`);
    return res.status(500).json({ message: "Login Failed" });
  }
}

export async function logout(req: Request, res: Response) {
  try {
    res.clearCookie("token");
    return res.status(201).json({ message: "Logout Succesfully" });
  } catch (e) {
    console.error(`Error Message: ${e}`);
    return res.status(500).json({ message: "Logout failed" });
  }
}
