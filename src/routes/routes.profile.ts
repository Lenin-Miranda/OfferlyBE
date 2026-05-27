import { Router } from "express";
import multer from "multer";
import { auth } from "../middleware/auth.js";
import {
  getProfile,
  updateProfile,
  summarizeResumeToProfileController,
} from "../controller/profileController.js";

const profileRouter = Router();
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

profileRouter.get("/", auth, getProfile);
profileRouter.patch("/", auth, updateProfile);
profileRouter.post(
  "/summarize-resume",
  auth,
  resumeUpload.single("resume"),
  summarizeResumeToProfileController,
);
export { profileRouter };
