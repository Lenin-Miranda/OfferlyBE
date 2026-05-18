import { type RequestHandler, type Response } from "express";
import { type AuthedRequest } from "../middleware/auth.js";
import {
  extractResumePdf,
  renderTailoredResumePdf,
} from "../integrations/resumePdf.js";
import { tailorResumeForJob } from "../integrations/llm.js";

type ResumeTailorRequest = AuthedRequest & {
  file: Express.Multer.File | undefined;
};

function getJobPostFromRequest(req: ResumeTailorRequest) {
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

export const tailorResumePdf: RequestHandler = async (req, res: Response) => {
  try {
    const request = req as ResumeTailorRequest;

    if (!request.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!request.file) {
      return res
        .status(400)
        .json({ message: "A resume PDF is required in the `resume` field" });
    }

    if (request.file.mimetype !== "application/pdf") {
      return res
        .status(400)
        .json({ message: "Only PDF resumes are supported for now" });
    }

    const jobPost = getJobPostFromRequest(request);
    if (!jobPost) {
      return res
        .status(400)
        .json({ message: "A job post is required in `jobPost`" });
    }

    const extractedResume = await extractResumePdf(request.file.buffer);
    if (extractedResume.pageCount !== 1) {
      return res.status(400).json({
        message:
          "The uploaded resume must be exactly 1 page. Multi-page resumes are not supported.",
      });
    }

    const editableLines = extractedResume.lines.filter(
      (line) => line.canEdit && line.text.length >= 4,
    );

    if (editableLines.length === 0) {
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

    return res.status(200).json({
      fileName:
        request.file.originalname.replace(/\.pdf$/i, "") + "-tailored.pdf",
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
    console.error("Error tailoring resume PDF:", error);
    return res.status(500).json({
      message: "Failed to tailor the resume PDF",
    });
  }
};
