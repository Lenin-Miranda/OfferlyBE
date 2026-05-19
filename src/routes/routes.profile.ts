import { Router } from "express";
import { auth } from "../middleware/auth.js";
import { getProfile, updateProfile } from "../controller/profileController.js";

const profileRouter = Router();

profileRouter.get("/", auth, getProfile);
profileRouter.patch("/", auth, updateProfile);

export { profileRouter };
