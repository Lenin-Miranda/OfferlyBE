import mongoose, { Schema, type InferSchemaType } from "mongoose";
const STATUS = [
  "applied",
  "interview",
  "offer",
  "rejected",
  "ghosted",
] as const;

const applicationSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  company: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  status: { type: String, enum: STATUS, required: true, default: "applied" },
  jobLink: { type: String, default: "", trim: true },
  dateApplied: { type: Date, default: null },
  notes: { type: String, default: true, trim: true },
});

export type ApplicationDoc = InferSchemaType<typeof applicationSchema>;
export const Application = mongoose.model("Application", applicationSchema);
export const ApplicationStatus = STATUS;
