import mongoose, { Schema, type InferSchemaType } from "mongoose";

const STATUS = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "accepted",
  "withdrawn",
  "ghosted",
] as const;

const LTC_RECOMMENDATIONS = ["apply", "consider", "skip"] as const;

const ltcAnalysisSchema = new Schema(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    recommendation: {
      type: String,
      required: true,
      enum: LTC_RECOMMENDATIONS,
    },
    summary: { type: String, required: true, trim: true },
    matchedSignals: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    gaps: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    missingProfileSignals: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    generatedAt: { type: Date, required: true },
  },
  {
    _id: false,
  },
);

const applicationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    company: { type: String, required: true, trim: true },
    position: { type: String, required: true, trim: true },
    status: { type: String, enum: STATUS, required: true, default: "applied" },
    location: { type: String, default: "", trim: true },
    salary: { type: Number, default: 0 },
    currency: { type: String, default: "$" },
    dateApplied: { type: Date, default: null },
    jobUrl: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    appliedAt: { type: Date, default: null },
    notes: { type: String, default: "", trim: true },
    ltcAnalysis: { type: ltcAnalysisSchema, default: null },
    analysisSkippedReason: { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
  },
);

export type ApplicationDoc = InferSchemaType<typeof applicationSchema>;
export const Application = mongoose.model("Application", applicationSchema);
export const ApplicationStatus = STATUS;
export const LtcRecommendations = LTC_RECOMMENDATIONS;
