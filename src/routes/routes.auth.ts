import { Router } from "express";
import {
  login,
  register,
  logout,
  checkAuth,
} from "../controller/authController.js";
import { auth } from "../middleware/auth.js";
const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/check-auth", auth, checkAuth);
authRouter.post("/logout", auth, logout);

export { authRouter };
