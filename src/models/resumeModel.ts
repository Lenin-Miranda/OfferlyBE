import mongoose, { Schema, type InferSchemaType } from "mongoose";

const resumeChangeSchema = new Schema(
  {
    lineId: { type: String, required: true, trim: true },
    page: { type: Number, required: true, min: 1 },
    originalText: { type: String, required: true, trim: true },
    replacementText: { type: String, required: true, trim: true },
    reason: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const skippedResumeChangeSchema = new Schema(
  {
    lineId: { type: String, required: true, trim: true },
    page: { type: Number, required: true, min: 1 },
    originalText: { type: String, required: true, trim: true },
    attemptedText: { type: String, required: true, trim: true },
    reason: { type: String, default: "", trim: true },
    skippedBecause: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const resumeSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "Application",
      default: null,
      index: true,
    },
    originalFileName: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, default: "application/pdf" },
    jobPost: { type: String, required: true, trim: true },
    summary: { type: String, required: true, trim: true },
    pdfData: { type: Buffer, required: true },
    changes: {
      type: [resumeChangeSchema],
      default: [],
    },
    skippedChanges: {
      type: [skippedResumeChangeSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

resumeSchema.index({ userId: 1, applicationId: 1, createdAt: -1 });

export type ResumeDoc = InferSchemaType<typeof resumeSchema>;
export const Resume = mongoose.model("Resume", resumeSchema);
