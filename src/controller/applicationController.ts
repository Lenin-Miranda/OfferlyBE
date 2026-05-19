import { Application, ApplicationStatus } from "../models/applicationModel.js";
import { type Response } from "express";
import { type AuthedRequest } from "../middleware/auth.js";
import mongoose from "mongoose";
import { Profile } from "../models/profileModel.js";
import { evaluateProfileJobMatch } from "../integrations/llm.js";

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

async function buildAnalysisFields(userId: string, description: string) {
  if (!description.trim()) {
    return {
      ltcAnalysis: null,
      analysisSkippedReason: "missing_job_description",
    };
  }

  const profile = await Profile.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  });

  if (!profile || !hasProfileSignal(profile)) {
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
    console.error("Error evaluating LTC analysis:", error);
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
      return res.status(401).json({ message: "User Not authenticated" });
    }

    if (!company || !position) {
      return res
        .status(400)
        .json({ message: "Company and position are required" });
    }

    if (status && !ApplicationStatus.includes(status)) {
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

    return res
      .status(201)
      .json({ app, message: "Application created successfully" });
  } catch (error) {
    console.error(`Error Message: ${error}`);
    return res.status(500).json({ message: "Error creating application" });
  }
}

export async function getApplication(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "User Not authenticated" });
    }

    const apps = await Application.find({
      userId: new mongoose.Types.ObjectId(req.userId),
    }).sort({
      createdAt: -1,
    });

    if (apps.length === 0) {
      return res.status(200).json({
        apps: [],
        message:
          "No applications found. Start by creating your first job application!",
      });
    }

    return res.status(200).json({ apps });
  } catch (error) {
    return res.status(500).json({ message: "Application retrieve failed" });
  }
}

export async function editApplication(req: AuthedRequest, res: Response) {
  try {
    const { id } = req.params;
    const updates = pickApplicationUpdates(req.body as Record<string, unknown>);

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!req.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (updates.status && !ApplicationStatus.includes(updates.status)) {
      return res.status(400).json({ message: "Invalid Status" });
    }

    const existingApp = await Application.findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(req.userId),
    });

    if (!existingApp) {
      return res.status(404).json({ message: "Not Found" });
    }

    const mergedDescription = updates.description ?? existingApp.description ?? "";
    const analysisFields = await buildAnalysisFields(req.userId, mergedDescription);

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

    return res.status(200).json({ app, message: "Updated Successfully" });
  } catch (e) {
    console.error(`Error message ${e}`);
    return res.status(500).json({ message: "Error Updating" });
  }
}

export async function deleteApplication(req: AuthedRequest, res: Response) {
  try {
    const { id } = req.params;

    if (!id || Array.isArray(id)) {
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (!req.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const deleted = await Application.findOneAndDelete({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(req.userId),
    });

    if (!deleted) return res.status(404).json({ message: "Not Found" });

    return res.status(200).json({ message: "Deleted" });
  } catch (e) {
    console.error(`Error Message: ${e}`);
    return res.status(500).json({ message: "Error Deleting" });
  }
}
