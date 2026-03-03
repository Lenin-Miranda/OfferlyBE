import { Router } from "express";
import { login, register, logout } from "../controller/authController.js";
import { auth } from "../middleware/auth.js";
const authRouter = Router();

authRouter.post("/signup", register);
authRouter.post("/login", login);
authRouter.post("/logout", auth, logout);

export { authRouter };
