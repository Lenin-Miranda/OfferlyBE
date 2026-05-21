import { PDFDocument } from "pdf-lib";
import {
  renderTailoredResumePdf,
  type ExtractedResumePdf,
} from "../integrations/resumePdf.js";

describe("renderTailoredResumePdf", () => {
  it("should allow a longer replacement when peer lines show the column is wider", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);

    const pdfBuffer = Buffer.from(await pdfDoc.save());
    const extractedResume: ExtractedResumePdf = {
      pageCount: 1,
      lines: [
        {
          id: "p1-l1",
          pageIndex: 0,
          text: "Built NestJS APIs powering legal intake workflows.",
          kind: "bullet",
          canEdit: true,
          x: 72,
          y: 700,
          width: 210,
          height: 14,
          fontSize: 12,
          fontName: "Helvetica",
          maxChars: 50,
        },
        {
          id: "p1-l2",
          pageIndex: 0,
          text: "Built e-commerce app with React, Node.js, MongoDB and REST APIs for product flows.",
          kind: "bullet",
          canEdit: true,
          x: 72,
          y: 680,
          width: 360,
          height: 14,
          fontSize: 12,
          fontName: "Helvetica",
          maxChars: 88,
        },
      ],
    };

    const result = await renderTailoredResumePdf({
      pdfBuffer,
      extractedResume,
      changes: [
        {
          lineId: "p1-l1",
          replacementText:
            "Built NestJS APIs powering legal intake workflows, focusing on reliability and scale",
          reason: "Test longer replacement in same column",
        },
      ],
    });

    expect(result.appliedChanges).toHaveLength(1);
    expect(result.rejectedChanges).toHaveLength(0);
  });

  it("should still reject replacements that are too wide for the available space", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);

    const pdfBuffer = Buffer.from(await pdfDoc.save());
    const extractedResume: ExtractedResumePdf = {
      pageCount: 1,
      lines: [
        {
          id: "p1-l1",
          pageIndex: 0,
          text: "Short line",
          kind: "body",
          canEdit: true,
          x: 72,
          y: 700,
          width: 110,
          height: 14,
          fontSize: 12,
          fontName: "Helvetica",
          maxChars: 10,
        },
      ],
    };

    const result = await renderTailoredResumePdf({
      pdfBuffer,
      extractedResume,
      changes: [
        {
          lineId: "p1-l1",
          replacementText:
            "This replacement is intentionally far too long for the small amount of horizontal space available on the original line and should still be rejected",
          reason: "Test true overflow rejection",
        },
      ],
    });

    expect(result.appliedChanges).toHaveLength(0);
    expect(result.rejectedChanges).toHaveLength(1);
    expect(result.rejectedChanges[0]?.rejectionReason).toBe(
      "replacement width exceeds available line width",
    );
  });
});
