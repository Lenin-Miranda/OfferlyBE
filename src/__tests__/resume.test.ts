import { jest } from "@jest/globals";
import request from "supertest";
import { connectTestDB, closeTestDb, clearDatabase } from "./setup.js";

const mockedTailorResumeForJob = jest.fn();
const mockedExtractResumePdf = jest.fn();
const mockedRenderTailoredResumePdf = jest.fn();

jest.unstable_mockModule("../integrations/llm.js", () => ({
  evaluateProfileJobMatch: jest.fn(),
  summarizeResumeToProfile: jest.fn(),
  tailorResumeForJob: mockedTailorResumeForJob,
}));

jest.unstable_mockModule("../integrations/resumePdf.js", () => ({
  extractResumePdf: mockedExtractResumePdf,
  renderTailoredResumePdf: mockedRenderTailoredResumePdf,
}));

const { default: app } = await import("../app.js");
const { Resume } = await import("../models/resumeModel.js");

const validUser = {
  email: "resume@test.com",
  password: "12345678",
};

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await clearDatabase();
  mockedTailorResumeForJob.mockReset();
  mockedExtractResumePdf.mockReset();
  mockedRenderTailoredResumePdf.mockReset();
});

async function createAuthedAgent() {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(validUser);
  return agent;
}

describe("Resume Routes", () => {
  it("should tailor a resume from a saved application and persist it", async () => {
    const agent = await createAuthedAgent();
    const applicationRes = await agent.post("/api/applications").send({
      company: "OpenAI",
      position: "Backend Engineer",
      description: "Looking for a backend engineer with Node.js and TypeScript.",
    });

    mockedExtractResumePdf.mockResolvedValue({
      pageCount: 1,
      lines: [
        {
          id: "p1-l1",
          pageIndex: 0,
          text: "Built backend APIs",
          kind: "bullet",
          canEdit: true,
          x: 72,
          y: 700,
          width: 220,
          height: 12,
          fontSize: 12,
          fontName: "Helvetica",
          maxChars: 42,
        },
      ],
    });
    mockedTailorResumeForJob.mockResolvedValue({
      summary: "Aligned the strongest backend bullet to the saved job post.",
      changes: [
        {
          lineId: "p1-l1",
          replacementText: "Built Node.js and TypeScript backend APIs",
          reason: "Match backend stack",
        },
      ],
    });
    mockedRenderTailoredResumePdf.mockResolvedValue({
      pdfBuffer: Buffer.from("%PDF-1.4 tailored", "utf8"),
      appliedChanges: [
        {
          lineId: "p1-l1",
          pageIndex: 0,
          originalText: "Built backend APIs",
          replacementText: "Built Node.js and TypeScript backend APIs",
          reason: "Match backend stack",
        },
      ],
      rejectedChanges: [],
    });

    const resumeBuffer = Buffer.from("%PDF-1.4\nresume", "utf8");
    const res = await agent
      .post(`/api/applications/${applicationRes.body.app._id}/resume/tailor`)
      .attach("resume", resumeBuffer, {
        filename: "resume.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(200);
    expect(res.body.applicationId).toBe(applicationRes.body.app._id);
    expect(res.body.resumeId).toBeDefined();
    expect(res.body.fileName).toBe("resume-tailored.pdf");
    expect(res.body.summary).toBe(
      "Aligned the strongest backend bullet to the saved job post.",
    );
    expect(mockedTailorResumeForJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobPost: "Looking for a backend engineer with Node.js and TypeScript.",
      }),
    );

    const storedResume = await Resume.findById(res.body.resumeId);
    expect(storedResume).not.toBeNull();
    expect(storedResume?.applicationId?.toString()).toBe(applicationRes.body.app._id);
    expect(storedResume?.summary).toBe(
      "Aligned the strongest backend bullet to the saved job post.",
    );
    expect(Buffer.from(storedResume?.pdfData ?? []).toString("utf8")).toBe(
      "%PDF-1.4 tailored",
    );
  });

  it("should list and fetch stored resumes for an application", async () => {
    const agent = await createAuthedAgent();
    const applicationRes = await agent.post("/api/applications").send({
      company: "Anthropic",
      position: "Platform Engineer",
      description: "Platform role with Node.js and infrastructure work.",
    });

    const storedResume = await Resume.create({
      userId: applicationRes.body.app.userId,
      applicationId: applicationRes.body.app._id,
      originalFileName: "resume.pdf",
      fileName: "resume-tailored.pdf",
      mimeType: "application/pdf",
      jobPost: "Platform role with Node.js and infrastructure work.",
      summary: "Saved tailored resume.",
      pdfData: Buffer.from("%PDF-1.4 saved", "utf8"),
      changes: [
        {
          lineId: "p1-l1",
          page: 1,
          originalText: "Built APIs",
          replacementText: "Built platform APIs",
          reason: "Match platform focus",
        },
      ],
      skippedChanges: [],
    });

    const listRes = await agent.get(
      `/api/applications/${applicationRes.body.app._id}/resumes`,
    );

    expect(listRes.status).toBe(200);
    expect(listRes.body.resumes).toHaveLength(1);
    expect(listRes.body.resumes[0]).toEqual(
      expect.objectContaining({
        id: storedResume._id.toString(),
        applicationId: applicationRes.body.app._id,
        fileName: "resume-tailored.pdf",
        summary: "Saved tailored resume.",
      }),
    );

    const getRes = await agent.get(
      `/api/applications/${applicationRes.body.app._id}/resumes/${storedResume._id}`,
    );

    expect(getRes.status).toBe(200);
    expect(getRes.body.resume.id).toBe(storedResume._id.toString());
    expect(getRes.body.resume.pdfBase64).toBe(
      Buffer.from("%PDF-1.4 saved", "utf8").toString("base64"),
    );
    expect(getRes.body.resume.changes).toHaveLength(1);
  });
});
