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
  },
  {
    timestamps: true,
  },
);

export type ApplicationDoc = InferSchemaType<typeof applicationSchema>;
export const Application = mongoose.model("Application", applicationSchema);
export const ApplicationStatus = STATUS;
