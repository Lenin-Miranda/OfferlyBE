import { type Response } from "express";
import { z } from "zod";
import { type AuthedRequest } from "../middleware/auth.js";
import {
  Profile,
  type ProfileDoc,
  RemotePreferences,
} from "../models/profileModel.js";
import { User } from "../models/userModel.js";
import { getRequestLogMeta, logger } from "../lib/logger.js";
import { summarizeResumeToProfile } from "../integrations/llm.js";

const stringArraySchema = z
  .array(z.string().trim())
  .transform((values) => values.filter(Boolean));

const profileUpdateSchema = z
  .object({
    fullName: z.string().trim().max(200),
    location: z.string().trim().max(200),
    summary: z.string().trim().max(2000),
    skills: stringArraySchema,
    yearsExperience: z.number().min(0).max(80),
    targetRoles: stringArraySchema,
    preferredLocations: stringArraySchema,
    remotePreference: z.enum(RemotePreferences),
    workAuthorization: z.string().trim().max(200),
  })
  .partial()
  .strict();

type ResumeProfileRequest = AuthedRequest & {
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
};

type SummarizedProfile = {
  fullName?: string | null | undefined;
  location?: string | null | undefined;
  summary?: string | null | undefined;
  skills?: string[] | null | undefined;
  yearsExperience?: number | null | undefined;
  targetRoles?: string[] | null | undefined;
  preferredLocations?: string[] | null | undefined;
  remotePreference?: (typeof RemotePreferences)[number] | null | undefined;
  workAuthorization?: string | null | undefined;
};

function dedupeStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isPdfBuffer(buffer: Buffer) {
  return buffer.subarray(0, 4).toString("utf8") === "%PDF";
}

function normalizeResumePdfBase64(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/^data:application\/pdf;base64,/i, "");
  const pdfBuffer = Buffer.from(normalized, "base64");

  if (!pdfBuffer.length || !isPdfBuffer(pdfBuffer)) {
    throw new Error("Invalid PDF payload");
  }

  return pdfBuffer.toString("base64");
}

function getSummarizeResumeInput(request: ResumeProfileRequest) {
  const uploadedFile =
    request.file ??
    request.files?.find((file) =>
      ["resume", "file", "pdf"].includes(file.fieldname.toLowerCase()),
    ) ??
    request.files?.[0];

  if (uploadedFile) {
    if (uploadedFile.mimetype !== "application/pdf") {
      throw new Error("Only PDF resumes are supported");
    }

    if (!isPdfBuffer(uploadedFile.buffer)) {
      throw new Error("Invalid PDF file");
    }

    return uploadedFile.buffer.toString("base64");
  }

  const body = request.body as {
    resumePdfBase64?: string;
    resumeBase64?: string;
    fileBase64?: string;
    pdfBase64?: string;
  };
  const resumePdfBase64 =
    body.resumePdfBase64 ??
    body.resumeBase64 ??
    body.fileBase64 ??
    body.pdfBase64;

  if (!resumePdfBase64) {
    throw new Error("Missing resume PDF");
  }

  return normalizeResumePdfBase64(resumePdfBase64);
}

function mergeSummarizedProfile(
  currentProfile: Pick<
    ProfileDoc,
    | "fullName"
    | "location"
    | "summary"
    | "skills"
    | "yearsExperience"
    | "targetRoles"
    | "preferredLocations"
    | "remotePreference"
    | "workAuthorization"
  >,
  suggestedProfile: SummarizedProfile,
) {
  const updates: Partial<ProfileDoc> = {};
  const updatedFields: string[] = [];

  const assignStringIfMissing = (
    key: "fullName" | "location" | "summary" | "workAuthorization",
  ) => {
    const currentValue = currentProfile[key].trim();
    const suggestedValue = suggestedProfile[key]?.trim();

    if (!currentValue && suggestedValue) {
      updates[key] = suggestedValue;
      updatedFields.push(key);
    }
  };

  assignStringIfMissing("fullName");
  assignStringIfMissing("location");
  assignStringIfMissing("summary");
  assignStringIfMissing("workAuthorization");

  if (
    currentProfile.yearsExperience <= 0 &&
    typeof suggestedProfile.yearsExperience === "number" &&
    suggestedProfile.yearsExperience > 0
  ) {
    updates.yearsExperience = suggestedProfile.yearsExperience;
    updatedFields.push("yearsExperience");
  }

  if (
    currentProfile.remotePreference === "unspecified" &&
    suggestedProfile.remotePreference &&
    suggestedProfile.remotePreference !== "unspecified"
  ) {
    updates.remotePreference = suggestedProfile.remotePreference;
    updatedFields.push("remotePreference");
  }

  const mergeArrayField = (
    key: "skills" | "targetRoles" | "preferredLocations",
  ) => {
    const currentValues = dedupeStrings(currentProfile[key]);
    const suggestedValues = dedupeStrings(suggestedProfile[key] ?? []);
    const mergedValues = dedupeStrings([...currentValues, ...suggestedValues]);

    if (mergedValues.length > currentValues.length) {
      updates[key] = mergedValues;
      updatedFields.push(key);
    }
  };

  mergeArrayField("skills");
  mergeArrayField("targetRoles");
  mergeArrayField("preferredLocations");

  return { updates, updatedFields };
}

function buildProfileResponse(
  userId: string,
  email: string,
  profile: {
    fullName: string;
    location: string;
    summary: string;
    skills: string[];
    yearsExperience: number;
    targetRoles: string[];
    preferredLocations: string[];
    remotePreference: (typeof RemotePreferences)[number];
    workAuthorization: string;
  },
) {
  return {
    userId,
    email,
    fullName: profile.fullName,
    location: profile.location,
    summary: profile.summary,
    skills: profile.skills,
    yearsExperience: profile.yearsExperience,
    targetRoles: profile.targetRoles,
    preferredLocations: profile.preferredLocations,
    remotePreference: profile.remotePreference,
    workAuthorization: profile.workAuthorization,
  };
}

async function getUserAndProfile(userId: string) {
  const user = await User.findById(userId).select("email");
  if (!user) {
    return null;
  }

  let profile = await Profile.findOne({ userId: user._id });
  if (!profile) {
    profile = await Profile.create({ userId: user._id });
  }

  return { user, profile };
}

export async function getProfile(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) {
      logger.warn(
        "Profile fetch rejected: unauthorized",
        getRequestLogMeta(req, res),
      );
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await getUserAndProfile(req.userId);
    if (!result) {
      logger.warn("Profile fetch rejected: user not found", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    logger.info("Profile fetched", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
    });

    return res.status(200).json({
      profile: buildProfileResponse(
        result.user._id.toString(),
        result.user.email,
        result.profile,
      ),
    });
  } catch (error) {
    logger.error("Failed to get profile", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      error,
    });
    return res.status(500).json({ message: "Failed to get profile" });
  }
}

export async function updateProfile(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) {
      logger.warn(
        "Profile update rejected: unauthorized",
        getRequestLogMeta(req, res),
      );
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("Profile update rejected: validation failed", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
        errors: parsed.error.flatten(),
      });
      return res.status(400).json({
        message: "Invalid profile update",
        errors: parsed.error.flatten(),
      });
    }

    const result = await getUserAndProfile(req.userId);
    if (!result) {
      logger.warn("Profile update rejected: user not found", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    const profile = await Profile.findOneAndUpdate(
      { userId: result.user._id },
      { $set: parsed.data },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    if (!profile) {
      logger.error("Profile update failed: database returned null", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
      });
      return res.status(500).json({ message: "Failed to update profile" });
    }

    logger.info("Profile updated", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      updatedFields: Object.keys(parsed.data),
    });

    return res.status(200).json({
      profile: buildProfileResponse(
        result.user._id.toString(),
        result.user.email,
        profile,
      ),
      message: "Profile updated successfully",
    });
  } catch (error) {
    logger.error("Failed to update profile", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      error,
    });
    return res.status(500).json({ message: "Failed to update profile" });
  }
}

export async function summarizeResumeToProfileController(
  req: AuthedRequest,
  res: Response,
) {
  try {
    const request = req as ResumeProfileRequest;

    if (!req.userId) {
      logger.warn(
        "Resume summarization rejected: unauthorized",
        getRequestLogMeta(req, res),
      );
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await getUserAndProfile(req.userId);
    if (!result) {
      logger.warn("Resume summarization rejected: user not found", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
      });
      return res.status(401).json({ message: "Unauthorized" });
    }

    let resumePdfBase64: string;
    try {
      resumePdfBase64 = getSummarizeResumeInput(request);
    } catch (error) {
      logger.warn("Resume summarization rejected: invalid resume payload", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
        error,
      });
      return res.status(400).json({
        message:
          error instanceof Error ? error.message : "Invalid resume payload",
      });
    }

    const suggestedProfile = await summarizeResumeToProfile(resumePdfBase64);
    const { updates, updatedFields } = mergeSummarizedProfile(
      result.profile,
      suggestedProfile,
    );

    if (updatedFields.length === 0) {
      logger.info("Resume summarization produced no new profile fields", {
        ...getRequestLogMeta(req, res),
        userId: req.userId,
      });
      return res.status(200).json({
        profile: buildProfileResponse(
          result.user._id.toString(),
          result.user.email,
          result.profile,
        ),
        message: "No new profile fields were inferred from the resume",
      });
    }

    const updatedProfile = await Profile.findOneAndUpdate(
      { userId: result.user._id },
      { $set: updates },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    if (!updatedProfile) {
      logger.error(
        "Failed to update profile with summarized resume data: database returned null",
        {
          ...getRequestLogMeta(req, res),
          userId: req.userId,
        },
      );
      return res
        .status(500)
        .json({
          message: "Failed to update profile with summarized resume data",
        });
    }

    logger.info("Profile updated with summarized resume data", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      updatedFields,
    });

    return res.status(200).json({
      profile: buildProfileResponse(
        result.user._id.toString(),
        result.user.email,
        updatedProfile,
      ),
      message: "Profile updated with summarized resume data successfully",
    });
  } catch (error) {
    logger.error("Failed to summarize resume and update profile", {
      ...getRequestLogMeta(req, res),
      userId: req.userId,
      error,
    });
    return res
      .status(500)
      .json({ message: "Failed to summarize resume and update profile" });
  }
}
