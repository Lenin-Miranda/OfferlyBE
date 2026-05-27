import { jest } from "@jest/globals";
import request from "supertest";
import { connectTestDB, closeTestDb, clearDatabase } from "./setup.js";

type MockLtcAnalysis = {
  score: number;
  recommendation: "apply" | "consider" | "skip";
  summary: string;
  matchedSignals: string[];
  gaps: string[];
  missingProfileSignals: string[];
};

const mockedEvaluateProfileJobMatch = jest.fn<
  (input: unknown) => Promise<MockLtcAnalysis>
>();

jest.unstable_mockModule("../integrations/llm.js", () => ({
  evaluateProfileJobMatch: mockedEvaluateProfileJobMatch,
  summarizeResumeToProfile: jest.fn(),
  tailorResumeForJob: jest.fn(),
}));

const { default: app } = await import("../app.js");

const validUser = {
  email: "test@test.com",
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
  mockedEvaluateProfileJobMatch.mockReset();
  mockedEvaluateProfileJobMatch.mockResolvedValue({
    score: 84,
    recommendation: "apply",
    summary: "Strong alignment with the role.",
    matchedSignals: ["Backend experience", "Node.js skills"],
    gaps: ["Missing AWS detail"],
    missingProfileSignals: ["No explicit system design examples"],
  });
});

async function createAuthedAgent() {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(validUser);
  return agent;
}

describe("Application Routes", () => {
  describe("POST /api/applications", () => {
    it("should create a new application with ltcAnalysis when profile and description are present", async () => {
      const agent = await createAuthedAgent();

      await agent.patch("/api/profile").send({
        summary: "Backend engineer with Node.js experience",
        skills: ["Node.js", "TypeScript"],
        yearsExperience: 4,
        targetRoles: ["Backend Engineer"],
      });

      const res = await agent.post("/api/applications").send({
        company: "Google",
        position: "Software Engineer",
        description: "Looking for a backend engineer with Node.js and TypeScript experience.",
      });

      expect(res.status).toBe(201);
      expect(res.body.app.company).toBe("Google");
      expect(res.body.app.position).toBe("Software Engineer");
      expect(res.body.app.ltcAnalysis.score).toBe(84);
      expect(res.body.app.analysisSkippedReason).toBeNull();
      expect(mockedEvaluateProfileJobMatch).toHaveBeenCalledTimes(1);
    });

    it("should create an application and skip analysis without description", async () => {
      const agent = await createAuthedAgent();

      await agent.patch("/api/profile").send({
        summary: "Backend engineer",
        skills: ["Node.js"],
      });

      const res = await agent.post("/api/applications").send({
        company: "Microsoft",
        position: "Product Manager",
      });

      expect(res.status).toBe(201);
      expect(res.body.app.ltcAnalysis).toBeNull();
      expect(res.body.app.analysisSkippedReason).toBe("missing_job_description");
      expect(mockedEvaluateProfileJobMatch).not.toHaveBeenCalled();
    });

    it("should create an application and skip analysis with insufficient profile", async () => {
      const agent = await createAuthedAgent();

      const res = await agent.post("/api/applications").send({
        company: "Amazon",
        position: "Software Engineer",
        description: "Strong backend engineer with distributed systems experience.",
      });

      expect(res.status).toBe(201);
      expect(res.body.app.ltcAnalysis).toBeNull();
      expect(res.body.app.analysisSkippedReason).toBe("insufficient_profile");
      expect(mockedEvaluateProfileJobMatch).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /api/applications/:id", () => {
    it("should recalculate ltcAnalysis when description changes", async () => {
      const agent = await createAuthedAgent();

      await agent.patch("/api/profile").send({
        summary: "Platform engineer",
        skills: ["Node.js", "Go"],
        yearsExperience: 5,
        targetRoles: ["Backend Engineer"],
      });

      const createRes = await agent.post("/api/applications").send({
        company: "Stripe",
        position: "Engineer",
        description: "Looking for backend Node.js experience.",
      });

      mockedEvaluateProfileJobMatch.mockResolvedValueOnce({
        score: 60,
        recommendation: "consider",
        summary: "Partial alignment after the update.",
        matchedSignals: ["Node.js experience"],
        gaps: ["No payment experience"],
        missingProfileSignals: [],
      });

      const res = await agent
        .patch(`/api/applications/${createRes.body.app._id}`)
        .send({
          description: "Need Node.js plus payments and API platform experience.",
          notes: "Updated job post",
        });

      expect(res.status).toBe(200);
      expect(res.body.app.notes).toBe("Updated job post");
      expect(res.body.app.ltcAnalysis.score).toBe(60);
      expect(res.body.app.ltcAnalysis.recommendation).toBe("consider");
      expect(mockedEvaluateProfileJobMatch).toHaveBeenCalledTimes(2);
    });

    it("should not recalculate ltcAnalysis when only status changes", async () => {
      const agent = await createAuthedAgent();

      await agent.patch("/api/profile").send({
        summary: "Backend engineer",
        skills: ["Node.js", "TypeScript"],
        yearsExperience: 4,
        targetRoles: ["Backend Engineer"],
      });

      const createRes = await agent.post("/api/applications").send({
        company: "Notion",
        position: "Software Engineer",
        description: "Node.js backend role with TypeScript.",
      });

      const res = await agent
        .patch(`/api/applications/${createRes.body.app._id}`)
        .send({ status: "interviewing" });

      expect(res.status).toBe(200);
      expect(res.body.app.status).toBe("interviewing");
      expect(res.body.app.ltcAnalysis.score).toBe(84);
      expect(mockedEvaluateProfileJobMatch).toHaveBeenCalledTimes(1);
    });

    it("should clear ltcAnalysis when description becomes empty", async () => {
      const agent = await createAuthedAgent();

      await agent.patch("/api/profile").send({
        summary: "Backend engineer",
        skills: ["Node.js"],
      });

      const createRes = await agent.post("/api/applications").send({
        company: "Linear",
        position: "Engineer",
        description: "Node.js backend role.",
      });

      const res = await agent
        .patch(`/api/applications/${createRes.body.app._id}`)
        .send({ description: "" });

      expect(res.status).toBe(200);
      expect(res.body.app.ltcAnalysis).toBeNull();
      expect(res.body.app.analysisSkippedReason).toBe("missing_job_description");
    });
  });

  describe("GET /api/applications", () => {
    it("should get all applications for authenticated user", async () => {
      const agent = await createAuthedAgent();

      await agent.post("/api/applications").send({
        company: "Google",
        position: "Software Engineer",
      });
      await agent.post("/api/applications").send({
        company: "Microsoft",
        position: "Product Manager",
      });

      const res = await agent.get("/api/applications");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.apps)).toBe(true);
      expect(res.body.apps.length).toBe(2);
    });
  });
});
