import { Router } from "express";
import {
  createApplication,
  getApplication,
  editApplication,
  deleteApplication,
} from "../controller/applicationController.js";
import { auth } from "../middleware/auth.js";

const applicationRouter = Router();

applicationRouter.post("/", auth, createApplication);
applicationRouter.get("/", auth, getApplication);
applicationRouter.patch("/:id", auth, editApplication);
applicationRouter.delete("/:id", auth, deleteApplication);

export { applicationRouter };
