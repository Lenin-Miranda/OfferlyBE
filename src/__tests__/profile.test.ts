import { jest } from "@jest/globals";
import request from "supertest";
import { connectTestDB, closeTestDb, clearDatabase } from "./setup.js";

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
});
