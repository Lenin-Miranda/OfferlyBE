import request from "supertest";
import app from "../app.js";
import { connectTestDB, closeTestDb, clearDatabase } from "./setup.js";

const validUser = {
  email: "test@test.com",
  password: "12345678",
};

const anotherUser = {
  email: "another@test.com",
  password: "12345678",
};

const validApplication = {
  company: "Google",
  title: "Software Engineer",
  status: "applied",
  jobLink: "https://careers.google.com/jobs/123",
  dateApplied: "2026-03-01",
  notes: "Excited about this opportunity",
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

describe("Application Routes", () => {
  describe("POST /application", () => {
    it("should create a new application with valid data", async () => {
      // Create user and get token
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send(validApplication);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("app");
      expect(res.body.app.company).toBe(validApplication.company);
      expect(res.body.app.title).toBe(validApplication.title);
      expect(res.body.app.status).toBe(validApplication.status);
      expect(res.body.message).toBe("Application created successfully");
    });

    it("should create application with minimum required fields", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Microsoft",
          title: "Product Manager",
        });

      expect(res.status).toBe(201);
      expect(res.body.app.company).toBe("Microsoft");
      expect(res.body.app.title).toBe("Product Manager");
      expect(res.body.app.status).toBe("applied"); // default value
    });

    it("should fail without authentication", async () => {
      const res = await request(app)
        .post("/application")
        .send(validApplication);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Missing token");
    });

    it("should fail without company", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: "Software Engineer",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("required");
    });

    it("should fail without title", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Amazon",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("required");
    });

    it("should fail with invalid status", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Facebook",
          title: "Data Scientist",
          status: "invalid_status",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid Status");
    });
  });

  describe("GET /application", () => {
    it("should get all applications for authenticated user", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      // Create multiple applications
      await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Google",
          title: "Software Engineer",
        });

      await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Microsoft",
          title: "Product Manager",
        });

      const res = await request(app)
        .get("/application")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("apps");
      expect(Array.isArray(res.body.apps)).toBe(true);
      expect(res.body.apps.length).toBe(2);
    });

    it("should return empty array if user has no applications", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .get("/application")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.apps).toEqual([]);
    });

    it("should fail without authentication", async () => {
      const res = await request(app).get("/application");

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Missing token");
    });

    it("should not return applications from other users", async () => {
      // Create first user and their application
      const authRes1 = await request(app).post("/auth/signup").send(validUser);
      const token1 = authRes1.body.token;

      await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token1}`)
        .send({
          company: "Google",
          title: "Engineer",
        });

      // Create second user and get their applications
      const authRes2 = await request(app)
        .post("/auth/signup")
        .send(anotherUser);
      const token2 = authRes2.body.token;

      const res = await request(app)
        .get("/application")
        .set("Authorization", `Bearer ${token2}`);

      expect(res.status).toBe(200);
      expect(res.body.apps.length).toBe(0); // Should not see user1's applications
    });
  });

  describe("PATCH /application/:id", () => {
    it("should update own application", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      // Create application
      const createRes = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Google",
          title: "Software Engineer",
          status: "applied",
        });

      const appId = createRes.body.app._id;

      // Update application
      const res = await request(app)
        .patch(`/application/${appId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({
          status: "interview",
          notes: "First round scheduled",
        });

      expect(res.status).toBe(200);
      expect(res.body.app.status).toBe("interview");
      expect(res.body.app.notes).toBe("First round scheduled");
      expect(res.body.message).toBe("Updated Successfully");
    });

    it("should fail without authentication", async () => {
      const res = await request(app)
        .patch("/application/507f1f77bcf86cd799439011")
        .send({ status: "interview" });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Missing token");
    });

    it("should fail when updating another user's application", async () => {
      // User 1 creates application
      const authRes1 = await request(app).post("/auth/signup").send(validUser);
      const token1 = authRes1.body.token;

      const createRes = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token1}`)
        .send({
          company: "Google",
          title: "Engineer",
        });

      const appId = createRes.body.app._id;

      // User 2 tries to update user 1's application
      const authRes2 = await request(app)
        .post("/auth/signup")
        .send(anotherUser);
      const token2 = authRes2.body.token;

      const res = await request(app)
        .patch(`/application/${appId}`)
        .set("Authorization", `Bearer ${token2}`)
        .send({ status: "rejected" });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Not Found");
    });

    it("should fail with non-existent application ID", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .patch("/application/507f1f77bcf86cd799439011")
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "interview" });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Not Found");
    });

    it("should fail with invalid status", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const createRes = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Google",
          title: "Engineer",
        });

      const appId = createRes.body.app._id;

      const res = await request(app)
        .patch(`/application/${appId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "invalid_status" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid Status");
    });
  });

  describe("DELETE /application/:id", () => {
    it("should delete own application", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      // Create application
      const createRes = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token}`)
        .send({
          company: "Google",
          title: "Engineer",
        });

      const appId = createRes.body.app._id;

      // Delete application
      const res = await request(app)
        .delete(`/application/${appId}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Deleted");

      // Verify it's deleted
      const getRes = await request(app)
        .get("/application")
        .set("Authorization", `Bearer ${token}`);

      expect(getRes.body.apps.length).toBe(0);
    });

    it("should fail without authentication", async () => {
      const res = await request(app).delete(
        "/application/507f1f77bcf86cd799439011",
      );

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Missing token");
    });

    it("should fail when deleting another user's application", async () => {
      // User 1 creates application
      const authRes1 = await request(app).post("/auth/signup").send(validUser);
      const token1 = authRes1.body.token;

      const createRes = await request(app)
        .post("/application")
        .set("Authorization", `Bearer ${token1}`)
        .send({
          company: "Google",
          title: "Engineer",
        });

      const appId = createRes.body.app._id;

      // User 2 tries to delete user 1's application
      const authRes2 = await request(app)
        .post("/auth/signup")
        .send(anotherUser);
      const token2 = authRes2.body.token;

      const res = await request(app)
        .delete(`/application/${appId}`)
        .set("Authorization", `Bearer ${token2}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Not Found");

      // Verify user 1's application still exists
      const getRes = await request(app)
        .get("/application")
        .set("Authorization", `Bearer ${token1}`);

      expect(getRes.body.apps.length).toBe(1);
    });

    it("should fail with non-existent application ID", async () => {
      const authRes = await request(app).post("/auth/signup").send(validUser);
      const token = authRes.body.token;

      const res = await request(app)
        .delete("/application/507f1f77bcf86cd799439011")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Not Found");
    });
  });
});
