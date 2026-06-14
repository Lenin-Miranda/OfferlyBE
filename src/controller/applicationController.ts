import { Application, ApplicationStatus } from "../models/applicationModel.js";
import { type Response } from "express";
import { type AuthedRequest } from "../middleware/auth.js";
import mongoose from "mongoose";
import { Profile } from "../models/profileModel.js";
import { Resume } from "../models/resumeModel.js";
import { evaluateProfileJobMatch } from "../integrations/llm.js";
import { getRequestLogMeta, logger } from "../lib/logger.js";

const PATCH_TIMINGS_ENABLED =
  process.env.LOG_APPLICATION_PATCH_TIMINGS === "true";

const APPLICATION_MUTABLE_FIELDS = [
  "company",
  "position",
  "status",
  "location",
  "salary",
  "currency",
  "jobUrl",
  "description",
  "appliedAt",
  "notes",
] as const;

type ApplicationMutation = {
  company?: string;
  position?: string;
  status?: (typeof ApplicationStatus)[number];
  location?: string;
  salary?: number;
  currency?: string;
  jobUrl?: string;
  description?: string;
  appliedAt?: Date | null;
  notes?: string;
};

function pickApplicationUpdates(body: Record<string, unknown>): ApplicationMutation {
  const updates: ApplicationMutation = {};

  for (const field of APPLICATION_MUTABLE_FIELDS) {
    const value = body[field];
    if (value === undefined) {
      continue;
    }

    if (field === "appliedAt") {
      updates.appliedAt =
        typeof value === "string" || value instanceof Date
          ? new Date(value)
          : null;
      continue;
    }

    (updates as Record<string, unknown>)[field] = value;
  }

  return updates;
}

function hasProfileSignal(profile: {
  summary: string;
  skills: string[];
  targetRoles: string[];
  yearsExperience: number;
}) {
  return (
    profile.summary.trim().length > 0 ||
    profile.skills.length > 0 ||
    profile.targetRoles.length > 0 ||
    profile.yearsExperience > 0
  );
}

function formatDurationMs(startNs: bigint, endNs: bigint) {
  return `${(Number(endNs - startNs) / 1_000_000).toFixed(2)}ms`;
}

function createPatchTimingLogger(req: AuthedRequest, res: Response) {
  const controllerStartedAtNs = process.hrtime.bigint();
  const requestStartedAtNs =
    typeof res.locals.requestStartedAtNs === "bigint"
      ? (res.locals.requestStartedAtNs as bigint)
      : controllerStartedAtNs;
  const authCompletedAtNs =
    typeof res.locals.authCompletedAtNs === "bigint"
      ? (res.locals.authCompletedAtNs as bigint)
      : null;

  return {
    logStage(stage: string, startedAtNs: bigint, endedAtNs = process.hrtime.bigint()) {
      if (!PATCH_TIMINGS_ENABLED) {
        return;
      }

      logger.info(`PATCH /api/applications/${req.params.id} ${stage}`, {
        ...getRequestLogMeta(req, res),
        duration: formatDurationMs(startedAtNs, endedAtNs),
      });
    },
    logBoundary() {
      if (!PATCH_TIMINGS_ENABLED) {
        return;
      }

      if (authCompletedAtNs) {
        logger.info(`PATCH /api/applications/${req.params.id} auth+middleware`, {
          ...getRequestLogMeta(req, res),
          duration: formatDurationMs(requestStartedAtNs, authCompletedAtNs),
        });
      }

      logger.info(`PATCH /api/applications/${req.params.id} before-controller`, {
        ...getRequestLogMeta(req, res),
        duration: formatDurationMs(requestStartedAtNs, controllerStartedAtNs),
      });
    },
    finish() {
      if (!PATCH_TIMINGS_ENABLED) {
        return;
      }

      const endedAtNs = process.hrtime.bigint();
      logger.info(`PATCH /api/applications/${req.params.id} controller-total`, {
        ...getRequestLogMeta(req, res),
        duration: formatDurationMs(controllerStartedAtNs, endedAtNs),
      });
      logger.info(`PATCH /api/applications/${req.params.id} request-total`, {
        ...getRequestLogMeta(req, res),
        duration: formatDurationMs(requestStartedAtNs, endedAtNs),
      });
    },
  };
}

async function buildAnalysisFields(userId: string, description: string) {
  if (!description.trim()) {
    logger.info("Application analysis skipped: missing job description", {
      userId,
    });
    return {
      ltcAnalysis: null,
      analysisSkippedReason: "missing_job_description",
    };
  }

  const profile = await Profile.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!profile || !hasProfileSignal(profile)) {
    logger.info("Application analysis skipped: insufficient profile", {
      userId,
    });
    return {
      ltcAnalysis: null,
      analysisSkippedReason: "insufficient_profile",
    };
  }

  try {
    const analysis = await evaluateProfileJobMatch({
      jobDescription: description,
      profile: {
        fullName: profile.fullName,
        location: profile.location,
        summary: profile.summary,
        skills: profile.skills,
        yearsExperience: profile.yearsExperience,
        targetRoles: profile.targetRoles,
        preferredLocations: profile.preferredLocations,
        remotePreference: profile.remotePreference,
        workAuthorization: profile.workAuthorization,
      },
    });

    return {
      ltcAnalysis: {
        ...analysis,
        generatedAt: new Date(),
      },
      analysisSkippedReason: null,
    };
  } catch (error) {
    logger.error("Application analysis failed", {
      userId,
      error,
    });
    return {
      ltcAnalysis: null,
      analysisSkippedReason: "analysis_failed",
    };
  }
}

export async function createApplication(req: AuthedRequest, res: Response) {
  try {
    const {
      company,
      position,
      status,
      location = "",
      salary = 0,
      currency = "$",
      jobUrl = "",
      description = "",
      appliedAt = null,
      notes = "",
    } = req.body;

    if (!req.userId) {
      logger.warn("Application creation rejected: unauthorized", getRequestLogMeta(req, res));
      return res.status(401).json({ message: "User Not authenticated" });
    }

    if (!company || !position) {
      logger.warn("Application creation rejected: missing required fields", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
      });
      return res
        .status(400)
        .json({ message: "Company and position are required" });
    }

    if (status && !ApplicationStatus.includes(status)) {
      logger.warn("Application creation rejected: invalid status", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
        status,
      });
      return res.status(400).json({ message: "Invalid Status" });
    }

    const analysisFields = await buildAnalysisFields(
      req.userId,
      typeof description === "string" ? description : "",
    );

    const app = await Application.create({
      userId: new mongoose.Types.ObjectId(req.userId),
      company,
      position,
      status: status || "applied",
      location,
      salary,
      currency,
      jobUrl,
      description,
      appliedAt: appliedAt ? new Date(appliedAt) : null,
      notes,
      ...analysisFields,
    });

    logger.info("Application created", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      applicationId: app._id.toString(),
      status: app.status,
    });

    return res
      .status(201)
      .json({ app, message: "Application created successfully" });
  } catch (error) {
    logger.error("Application creation failed", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      error,
    });
    return res.status(500).json({ message: "Error creating application" });
  }
}

export async function getApplication(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) {
      logger.warn("Application list rejected: unauthorized", getRequestLogMeta(req, res));
      return res.status(401).json({ message: "User Not authenticated" });
    }

    const apps = await Application.find({
      userId: new mongoose.Types.ObjectId(req.userId),
    }).sort({
      createdAt: -1,
    });

    if (apps.length === 0) {
      logger.info("Application list returned empty", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
      });
      return res.status(200).json({
        apps: [],
        message:
          "No applications found. Start by creating your first job application!",
      });
    }

    logger.info("Application list fetched", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      count: apps.length,
    });

    return res.status(200).json({ apps });
  } catch (error) {
    logger.error("Application list failed", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      error,
    });
    return res.status(500).json({ message: "Application retrieve failed" });
  }
}

export async function editApplication(req: AuthedRequest, res: Response) {
  const patchTiming = createPatchTimingLogger(req, res);
  try {
    const { id } = req.params;
    const updates = pickApplicationUpdates(req.body as Record<string, unknown>);
    const shouldRebuildAnalysis = Object.prototype.hasOwnProperty.call(
      updates,
      "description",
    );

    if (!id || Array.isArray(id)) {
      logger.warn("Application update rejected: invalid id", getRequestLogMeta(req, res));
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!req.userId) {
      logger.warn("Application update rejected: unauthorized", {
        ...getRequestLogMeta(req, res),
        applicationId: id,
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (updates.status && !ApplicationStatus.includes(updates.status)) {
      logger.warn("Application update rejected: invalid status", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
        applicationId: id,
        status: updates.status,
      });
      return res.status(400).json({ message: "Invalid Status" });
    }

    patchTiming.logBoundary();

    let analysisFields = {};
    if (shouldRebuildAnalysis) {
      const analysisStartedAtNs = process.hrtime.bigint();
      analysisFields = await buildAnalysisFields(
        req.userId,
        updates.description ?? "",
      );
      patchTiming.logStage("analysis", analysisStartedAtNs);
    }

    const dbStartedAtNs = process.hrtime.bigint();
    const app = await Application.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        userId: new mongoose.Types.ObjectId(req.userId),
      },
      {
        $set: {
          ...updates,
          ...analysisFields,
        },
      },
      { returnDocument: "after" },
    );
    patchTiming.logStage("db-update", dbStartedAtNs);

    if (!app) {
      logger.warn("Application update rejected: application not found", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
        applicationId: id,
      });
      return res.status(404).json({ message: "Not Found" });
    }

    patchTiming.finish();
    logger.info("Application updated", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      applicationId: id,
      updatedFields: Object.keys(updates),
    });
    return res.status(200).json({ app, message: "Updated Successfully" });
  } catch (e) {
    logger.error("Application update failed", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      applicationId: req.params.id,
      error: e,
    });
    return res.status(500).json({ message: "Error Updating" });
  }
}

export async function deleteApplication(req: AuthedRequest, res: Response) {
  try {
    const { id } = req.params;

    if (!id || Array.isArray(id)) {
      logger.warn("Application delete rejected: invalid id", getRequestLogMeta(req, res));
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!req.userId) {
      logger.warn("Application delete rejected: unauthorized", {
        ...getRequestLogMeta(req, res),
        applicationId: id,
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    const deleted = await Application.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(req.userId),
    });

    if (!deleted) {
      logger.warn("Application delete rejected: application not found", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
        applicationId: id,
      });
      return res.status(404).json({ message: "Not Found" });
    }

    const deletedResumes = await Resume.deleteMany({
      userId: new mongoose.Types.ObjectId(req.userId),
      applicationId: deleted._id,
    });

    logger.info("Application deleted", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      applicationId: id,
      deletedResumes: deletedResumes.deletedCount,
    });

    return res.status(200).json({ message: "Deleted" });
  } catch (e) {
    logger.error("Application delete failed", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      applicationId: req.params.id,
      error: e,
    });
    return res.status(500).json({ message: "Error Deleting" });
  }
}
