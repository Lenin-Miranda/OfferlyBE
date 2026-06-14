import { type RequestHandler, Router } from "express";
import multer from "multer";
import {
  createApplication,
  getApplication,
  editApplication,
  deleteApplication,
} from "../controller/applicationController.js";
import { auth } from "../middleware/auth.js";

const applicationRouter = Router();
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

const lazyTailorResumePdf: RequestHandler = async (req, res, next) => {
  try {
    const { tailorResumePdf } = await import("../controller/resumeController.js");
    await tailorResumePdf(req, res, next);
  } catch (error) {
    next(error);
  }
};

const lazyListApplicationResumes: RequestHandler = async (req, res, next) => {
  try {
    const { listApplicationResumes } = await import(
      "../controller/resumeController.js"
    );
    await listApplicationResumes(req, res, next);
  } catch (error) {
    next(error);
  }
};

const lazyGetApplicationResume: RequestHandler = async (req, res, next) => {
  try {
    const { getApplicationResume } = await import("../controller/resumeController.js");
    await getApplicationResume(req, res, next);
  } catch (error) {
    next(error);
  }
};

const patchTimingProbe: RequestHandler = (req, res, next) => {
  if (
    process.env.LOG_APPLICATION_PATCH_TIMINGS === "true" &&
    req.method === "PATCH"
  ) {
    res.locals.requestStartedAtNs = process.hrtime.bigint();
  }

  next();
};

applicationRouter.post(
  "/resume/tailor",
  auth,
  resumeUpload.single("resume"),
  lazyTailorResumePdf,
);
applicationRouter.post(
  "/:id/resume/tailor",
  auth,
  resumeUpload.single("resume"),
  lazyTailorResumePdf,
);
applicationRouter.get("/:id/resumes", auth, lazyListApplicationResumes);
applicationRouter.get("/:id/resumes/:resumeId", auth, lazyGetApplicationResume);
applicationRouter.post("/", auth, createApplication);
applicationRouter.get("/", auth, getApplication);
applicationRouter.patch("/:id", patchTimingProbe, auth, editApplication);
applicationRouter.delete("/:id", auth, deleteApplication);

export { applicationRouter };
