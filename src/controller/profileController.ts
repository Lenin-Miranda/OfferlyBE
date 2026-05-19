import { type Response } from "express";
import { z } from "zod";
import { type AuthedRequest } from "../middleware/auth.js";
import { Profile, RemotePreferences } from "../models/profileModel.js";
import { User } from "../models/userModel.js";

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

function buildProfileResponse(userId: string, email: string, profile: {
  fullName: string;
  location: string;
  summary: string;
  skills: string[];
  yearsExperience: number;
  targetRoles: string[];
  preferredLocations: string[];
  remotePreference: (typeof RemotePreferences)[number];
  workAuthorization: string;
}) {
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
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await getUserAndProfile(req.userId);
    if (!result) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    return res.status(200).json({
      profile: buildProfileResponse(
        result.user._id.toString(),
        result.user.email,
        result.profile,
      ),
    });
  } catch (error) {
    console.error("Error getting profile:", error);
    return res.status(500).json({ message: "Failed to get profile" });
  }
}

export async function updateProfile(req: AuthedRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid profile update",
        errors: parsed.error.flatten(),
      });
    }

    const result = await getUserAndProfile(req.userId);
    if (!result) {
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
      return res.status(500).json({ message: "Failed to update profile" });
    }

    return res.status(200).json({
      profile: buildProfileResponse(
        result.user._id.toString(),
        result.user.email,
        profile,
      ),
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    return res.status(500).json({ message: "Failed to update profile" });
  }
}
