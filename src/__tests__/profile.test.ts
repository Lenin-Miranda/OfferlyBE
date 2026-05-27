import { jest } from "@jest/globals";
import request from "supertest";
import { connectTestDB, closeTestDb, clearDatabase } from "./setup.js";

const mockedSummarizeResumeToProfile = jest.fn<
  (resumePdfBase64: string) => Promise<Record<string, unknown>>
>();

jest.unstable_mockModule("../integrations/llm.js", () => ({
  evaluateProfileJobMatch: jest.fn(),
  tailorResumeForJob: jest.fn(),
  summarizeResumeToProfile: mockedSummarizeResumeToProfile,
}));

const { default: app } = await import("../app.js");

const validUser = {
  email: "profile@test.com",
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
  mockedSummarizeResumeToProfile.mockReset();
});

async function createAuthedAgent() {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send(validUser);
  return agent;
}

describe("Profile Routes", () => {
  it("should get the authenticated profile including email from user", async () => {
    const agent = await createAuthedAgent();

    const res = await agent.get("/api/profile");

    expect(res.status).toBe(200);
    expect(res.body.profile.email).toBe(validUser.email);
    expect(res.body.profile.fullName).toBe("");
    expect(res.body.profile.skills).toEqual([]);
    expect(res.body.profile.remotePreference).toBe("unspecified");
  });

  it("should update valid profile fields", async () => {
    const agent = await createAuthedAgent();

    const res = await agent.patch("/api/profile").send({
      fullName: "Ada Lovelace",
      location: "San Francisco, CA",
      summary: "Backend engineer focused on APIs and data platforms.",
      skills: ["Node.js", "TypeScript", "MongoDB"],
      yearsExperience: 6,
      targetRoles: ["Senior Backend Engineer"],
      preferredLocations: ["Remote", "San Francisco"],
      remotePreference: "remote",
      workAuthorization: "US Citizen",
    });

    expect(res.status).toBe(200);
    expect(res.body.profile.email).toBe(validUser.email);
    expect(res.body.profile.fullName).toBe("Ada Lovelace");
    expect(res.body.profile.skills).toEqual([
      "Node.js",
      "TypeScript",
      "MongoDB",
    ]);
    expect(res.body.profile.yearsExperience).toBe(6);
  });

  it("should reject unauthenticated access", async () => {
    const res = await request(app).get("/api/profile");

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Missing token");
  });

  it("should not allow updating email through profile", async () => {
    const agent = await createAuthedAgent();

    const res = await agent.patch("/api/profile").send({
      email: "hacker@test.com",
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid profile update");
  });

  it("should summarize a resume and only fill missing profile fields", async () => {
    const agent = await createAuthedAgent();
    mockedSummarizeResumeToProfile.mockResolvedValue({
      fullName: "LLM Candidate",
      location: "Austin, TX",
      summary: "LLM generated summary",
      skills: ["Node.js", "TypeScript"],
      yearsExperience: 6,
      targetRoles: ["Backend Engineer"],
      preferredLocations: ["Remote"],
      remotePreference: "remote",
      workAuthorization: "US Citizen",
    });

    await agent.patch("/api/profile").send({
      fullName: "Existing Name",
      summary: "Existing summary",
      skills: ["TypeScript"],
    });

    const resumeBuffer = Buffer.from("%PDF-1.4\nfake resume", "utf8");
    const res = await agent
      .post("/api/profile/summarize-resume")
      .attach("resume", resumeBuffer, {
        filename: "resume.pdf",
        contentType: "application/pdf",
      });

    expect(res.status).toBe(200);
    expect(mockedSummarizeResumeToProfile).toHaveBeenCalledTimes(1);
    expect(res.body.profile.fullName).toBe("Existing Name");
    expect(res.body.profile.summary).toBe("Existing summary");
    expect(res.body.profile.location).toBe("Austin, TX");
    expect(res.body.profile.skills).toEqual(["TypeScript", "Node.js"]);
    expect(res.body.profile.yearsExperience).toBe(6);
    expect(res.body.profile.targetRoles).toEqual(["Backend Engineer"]);
    expect(res.body.profile.preferredLocations).toEqual(["Remote"]);
    expect(res.body.profile.remotePreference).toBe("remote");
    expect(res.body.profile.workAuthorization).toBe("US Citizen");
  });

  it("should accept resumePdfBase64 data URLs and return unchanged profile when nothing new is inferred", async () => {
    const agent = await createAuthedAgent();
    mockedSummarizeResumeToProfile.mockResolvedValue({
      fullName: "Existing Name",
    });

    await agent.patch("/api/profile").send({
      fullName: "Existing Name",
      location: "San Jose, CA",
      summary: "Existing summary",
      skills: ["TypeScript"],
      yearsExperience: 4,
      targetRoles: ["Backend Engineer"],
      preferredLocations: ["Remote"],
      remotePreference: "remote",
      workAuthorization: "US Citizen",
    });

    const resumePdfBase64 = `data:application/pdf;base64,${Buffer.from(
      "%PDF-1.4\nfake resume",
      "utf8",
    ).toString("base64")}`;

    const res = await agent.post("/api/profile/summarize-resume").send({
      resumePdfBase64,
    });

    expect(res.status).toBe(200);
    expect(mockedSummarizeResumeToProfile).toHaveBeenCalledTimes(1);
    expect(res.body.message).toBe(
      "No new profile fields were inferred from the resume",
    );
    expect(res.body.profile.fullName).toBe("Existing Name");
    expect(res.body.profile.location).toBe("San Jose, CA");
    expect(res.body.profile.skills).toEqual(["TypeScript"]);
  });
});
