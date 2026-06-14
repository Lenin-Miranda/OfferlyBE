import mongoose from "mongoose";
import { type RequestHandler, type Response } from "express";
import { type AuthedRequest } from "../middleware/auth.js";
import {
  extractResumePdf,
  renderTailoredResumePdf,
} from "../integrations/resumePdf.js";
import { tailorResumeForJob } from "../integrations/llm.js";
import { Application } from "../models/applicationModel.js";
import { Resume } from "../models/resumeModel.js";
import { getRequestLogMeta, logger } from "../lib/logger.js";

type ResumeTailorRequest = AuthedRequest & {
  file: Express.Multer.File | undefined;
};

function getJobPostFromBody(req: ResumeTailorRequest) {
  const candidateValues = [
    req.body.jobPost,
    req.body.jobDescription,
    req.body.description,
  ];

  for (const value of candidateValues) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function getApplicationIdFromRequest(req: ResumeTailorRequest) {
  if (typeof req.params.id === "string" && req.params.id.trim()) {
    return req.params.id.trim();
  }

  if (typeof req.body.applicationId === "string" && req.body.applicationId.trim()) {
    return req.body.applicationId.trim();
  }

  return "";
}

function serializeResumeSummary(resume: InstanceType<typeof Resume>) {
  return {
    id: resume._id.toString(),
    applicationId: resume.applicationId ? resume.applicationId.toString() : null,
    originalFileName: resume.originalFileName,
    fileName: resume.fileName,
    mimeType: resume.mimeType,
    summary: resume.summary,
    changeCount: resume.changes.length,
    skippedChangeCount: resume.skippedChanges.length,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  };
}

function serializeResumeDetail(resume: InstanceType<typeof Resume>) {
  return {
    ...serializeResumeSummary(resume),
    pdfBase64: Buffer.from(resume.pdfData).toString("base64"),
    changes: resume.changes,
    skippedChanges: resume.skippedChanges,
  };
}

export const tailorResumePdf: RequestHandler = async (req, res: Response) => {
  try {
    const request = req as ResumeTailorRequest;

    if (!request.userId) {
      logger.warn("Resume tailoring rejected: unauthorized", getRequestLogMeta(request, res));
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!request.file) {
      logger.warn("Resume tailoring rejected: missing file", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
      });
      return res
        .status(400)
        .json({ message: "A resume PDF is required in the `resume` field" });
    }

    if (request.file.mimetype !== "application/pdf") {
      logger.warn("Resume tailoring rejected: invalid mimetype", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        mimetype: request.file.mimetype,
      });
      return res
        .status(400)
        .json({ message: "Only PDF resumes are supported for now" });
    }

    const applicationId = getApplicationIdFromRequest(request);
    let application: InstanceType<typeof Application> | null = null;

    if (applicationId) {
      if (!mongoose.isValidObjectId(applicationId)) {
        logger.warn("Resume tailoring rejected: invalid application id", {
          ...getRequestLogMeta(request, res),
          userId: request.userId,
          applicationId,
        });
        return res.status(400).json({ message: "Invalid application ID" });
      }

      application = await Application.findOne({
        _id: new mongoose.Types.ObjectId(applicationId),
        userId: new mongoose.Types.ObjectId(request.userId),
      });

      if (!application) {
        logger.warn("Resume tailoring rejected: application not found", {
          ...getRequestLogMeta(request, res),
          userId: request.userId,
          applicationId,
        });
        return res.status(404).json({ message: "Application not found" });
      }
    }

    const jobPostFromBody = getJobPostFromBody(request);
    const jobPost = application?.description.trim() || jobPostFromBody;
    if (!jobPost) {
      logger.warn("Resume tailoring rejected: missing job post", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        applicationId: application?._id.toString() ?? null,
      });
      return res.status(400).json({
        message: application
          ? "The selected application does not have a job description to tailor against"
          : "A job post is required in `jobPost`",
      });
    }

    const extractedResume = await extractResumePdf(request.file.buffer);
    if (extractedResume.pageCount !== 1) {
      logger.warn("Resume tailoring rejected: invalid page count", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        pageCount: extractedResume.pageCount,
      });
      return res.status(400).json({
        message:
          "The uploaded resume must be exactly 1 page. Multi-page resumes are not supported.",
      });
    }

    const editableLines = extractedResume.lines.filter(
      (line) => line.canEdit && line.text.length >= 4,
    );

    if (editableLines.length === 0) {
      logger.warn("Resume tailoring rejected: no editable lines", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
      });
      return res.status(400).json({
        message:
          "No editable resume lines were found in the uploaded PDF. Try a text-based PDF instead of a scanned image.",
      });
    }

    const tailoring = await tailorResumeForJob({
      resumePdfBase64: request.file.buffer.toString("base64"),
      jobPost,
      resumeLines: editableLines.map((line) => ({
        id: line.id,
        page: line.pageIndex + 1,
        text: line.text,
        kind: line.kind,
        maxChars: line.maxChars,
      })),
    });

    const renderedResume = await renderTailoredResumePdf({
      pdfBuffer: request.file.buffer,
      extractedResume,
      changes: tailoring.changes,
    });

    const fileName =
      request.file.originalname.replace(/\.pdf$/i, "") + "-tailored.pdf";
    const savedResume = await Resume.create({
      userId: new mongoose.Types.ObjectId(request.userId),
      applicationId: application?._id ?? null,
      originalFileName: request.file.originalname,
      fileName,
      mimeType: "application/pdf",
      jobPost,
      summary: tailoring.summary,
      pdfData: renderedResume.pdfBuffer,
      changes: renderedResume.appliedChanges.map((change) => ({
        lineId: change.lineId,
        page: change.pageIndex + 1,
        originalText: change.originalText,
        replacementText: change.replacementText,
        reason: change.reason,
      })),
      skippedChanges: renderedResume.rejectedChanges.map((change) => ({
        lineId: change.lineId,
        page: change.pageIndex + 1,
        originalText: change.originalText,
        attemptedText: change.replacementText,
        reason: change.reason,
        skippedBecause: change.rejectionReason,
      })),
    });

    logger.info("Resume tailored", {
      ...getRequestLogMeta(request, res),
      userId: request.userId,
      applicationId: application?._id.toString() ?? null,
      resumeId: savedResume._id.toString(),
      fileName: request.file.originalname,
      editableLines: editableLines.length,
      appliedChanges: renderedResume.appliedChanges.length,
      skippedChanges: renderedResume.rejectedChanges.length,
    });

    return res.status(200).json({
      resumeId: savedResume._id.toString(),
      applicationId: application?._id.toString() ?? null,
      fileName,
      mimeType: "application/pdf",
      pdfBase64: renderedResume.pdfBuffer.toString("base64"),
      summary: tailoring.summary,
      changes: renderedResume.appliedChanges.map((change) => ({
        lineId: change.lineId,
        page: change.pageIndex + 1,
        originalText: change.originalText,
        replacementText: change.replacementText,
        reason: change.reason,
      })),
      skippedChanges: renderedResume.rejectedChanges.map((change) => ({
        lineId: change.lineId,
        page: change.pageIndex + 1,
        originalText: change.originalText,
        attemptedText: change.replacementText,
        reason: change.reason,
        skippedBecause: change.rejectionReason,
      })),
      notes: {
        preservedLayout:
          "best effort; the service keeps the original PDF layout and only overwrites detected text lines that still fit in the same space",
      },
    });
  } catch (error) {
    logger.error("Resume tailoring failed", {
      ...getRequestLogMeta(req, res),
      userId: (req as ResumeTailorRequest).userId,
      error,
    });
    return res.status(500).json({
      message: "Failed to tailor the resume PDF",
    });
  }
};

export const listApplicationResumes: RequestHandler = async (
  req,
  res: Response,
) => {
  try {
    const request = req as AuthedRequest;
    const { id } = request.params;

    if (!request.userId) {
      logger.warn("Resume list rejected: unauthorized", getRequestLogMeta(request, res));
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!id || Array.isArray(id) || !mongoose.isValidObjectId(id)) {
      logger.warn("Resume list rejected: invalid application id", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        applicationId: id,
      });
      return res.status(400).json({ message: "Invalid application ID" });
    }

    const application = await Application.findOne({
      _id: new mongoose.Types.ObjectId(id),
      userId: new mongoose.Types.ObjectId(request.userId),
    });

    if (!application) {
      logger.warn("Resume list rejected: application not found", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        applicationId: id,
      });
      return res.status(404).json({ message: "Application not found" });
    }

    const resumes = await Resume.find({
      userId: new mongoose.Types.ObjectId(request.userId),
      applicationId: application._id,
    }).sort({ createdAt: -1 });

    logger.info("Resume list fetched", {
      ...getRequestLogMeta(request, res),
      userId: request.userId,
      applicationId: id,
      count: resumes.length,
    });

    return res.status(200).json({
      resumes: resumes.map((resume) => serializeResumeSummary(resume)),
    });
  } catch (error) {
    logger.error("Resume list failed", {
      ...getRequestLogMeta(req, res),
      userId: (req as AuthedRequest).userId,
      applicationId: req.params.id,
      error,
    });
    return res.status(500).json({ message: "Failed to fetch application resumes" });
  }
};

export const getApplicationResume: RequestHandler = async (
  req,
  res: Response,
) => {
  try {
    const request = req as AuthedRequest;
    const { id, resumeId } = request.params;

    if (!request.userId) {
      logger.warn("Resume fetch rejected: unauthorized", getRequestLogMeta(request, res));
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!id || Array.isArray(id) || !mongoose.isValidObjectId(id)) {
      logger.warn("Resume fetch rejected: invalid application id", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        applicationId: id,
      });
      return res.status(400).json({ message: "Invalid application ID" });
    }

    if (
      !resumeId ||
      Array.isArray(resumeId) ||
      !mongoose.isValidObjectId(resumeId)
    ) {
      logger.warn("Resume fetch rejected: invalid resume id", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        applicationId: id,
        resumeId,
      });
      return res.status(400).json({ message: "Invalid resume ID" });
    }

    const resume = await Resume.findOne({
      _id: new mongoose.Types.ObjectId(resumeId),
      userId: new mongoose.Types.ObjectId(request.userId),
      applicationId: new mongoose.Types.ObjectId(id),
    });

    if (!resume) {
      logger.warn("Resume fetch rejected: resume not found", {
        ...getRequestLogMeta(request, res),
        userId: request.userId,
        applicationId: id,
        resumeId,
      });
      return res.status(404).json({ message: "Resume not found" });
    }

    logger.info("Resume fetched", {
      ...getRequestLogMeta(request, res),
      userId: request.userId,
      applicationId: id,
      resumeId,
    });

    return res.status(200).json({
      resume: serializeResumeDetail(resume),
    });
  } catch (error) {
    logger.error("Resume fetch failed", {
      ...getRequestLogMeta(req, res),
      userId: (req as AuthedRequest).userId,
      applicationId: req.params.id,
      resumeId: req.params.resumeId,
      error,
    });
    return res.status(500).json({ message: "Failed to fetch application resume" });
  }
};
