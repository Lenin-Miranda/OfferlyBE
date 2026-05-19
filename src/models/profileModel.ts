import mongoose, { Schema, type InferSchemaType } from "mongoose";

const REMOTE_PREFERENCES = [
  "remote",
  "hybrid",
  "onsite",
  "flexible",
  "unspecified",
] as const;

const profileSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    fullName: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },
    summary: { type: String, default: "", trim: true },
    skills: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    yearsExperience: { type: Number, default: 0, min: 0 },
    targetRoles: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    preferredLocations: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    remotePreference: {
      type: String,
      enum: REMOTE_PREFERENCES,
      default: "unspecified",
    },
    workAuthorization: { type: String, default: "", trim: true },
  },
  {
    timestamps: true,
  },
);

export type ProfileDoc = InferSchemaType<typeof profileSchema>;
export const Profile = mongoose.model("Profile", profileSchema);
export const RemotePreferences = REMOTE_PREFERENCES;
