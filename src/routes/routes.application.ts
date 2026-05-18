import { Router } from "express";
import multer from "multer";
import {
  createApplication,
  getApplication,
  editApplication,
  deleteApplication,
} from "../controller/applicationController.js";
import { auth } from "../middleware/auth.js";
import { tailorResumePdf } from "../controller/resumeController.js";

const applicationRouter = Router();
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

applicationRouter.post(
  "/resume/tailor",
  auth,
  resumeUpload.single("resume"),
  tailorResumePdf,
);
applicationRouter.post("/", auth, createApplication);
applicationRouter.get("/", auth, getApplication);
applicationRouter.patch("/:id", auth, editApplication);
applicationRouter.delete("/:id", auth, deleteApplication);

export { applicationRouter };
