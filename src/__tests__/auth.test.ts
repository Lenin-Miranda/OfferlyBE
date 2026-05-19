import { jest } from "@jest/globals";
import request from "supertest";
import { connectTestDB, closeTestDb, clearDatabase } from "./setup.js";

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
});

describe("Auth Routes", () => {
  describe("POST /api/auth/register", () => {
    it("should create a new user with valid credentials", async () => {
      const res = await request(app).post("/api/auth/register").send(validUser);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user).toHaveProperty("id");
      expect(res.body.user.email).toBe(validUser.email);
      expect(res.body.message).toBe("User Succesfully Registered");
    });

    it("should set httpOnly cookie on register", async () => {
      const res = await request(app).post("/api/auth/register").send(validUser);

      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.headers["set-cookie"]![0]).toMatch(/token=/);
      expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/);
    });

    it("should fail with missing email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "",
        password: "12345678",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email and Password are required");
    });

    it("should fail if email already exists", async () => {
      await request(app).post("/api/auth/register").send(validUser);
      const res = await request(app).post("/api/auth/register").send(validUser);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Email is already in use");
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await request(app).post("/api/auth/register").send(validUser);
    });

    it("should login with valid credentials", async () => {
      const res = await request(app).post("/api/auth/login").send(validUser);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body.user.email).toBe(validUser.email);
      expect(res.body.message).toBe("Login Succesful");
    });

    it("should set httpOnly cookie on login", async () => {
      const res = await request(app).post("/api/auth/login").send(validUser);

      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.headers["set-cookie"]![0]).toMatch(/token=/);
      expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/);
    });

    it("should fail with incorrect password", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: validUser.email,
        password: "wrongpassword",
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid Credentials");
    });
  });

  describe("GET /api/auth/check-auth", () => {
    it("should return the authenticated user", async () => {
      const agent = request.agent(app);
      await agent.post("/api/auth/register").send(validUser);

      const res = await agent.get("/api/auth/check-auth");

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(validUser.email);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should clear cookie on logout", async () => {
      const agent = request.agent(app);
      await agent.post("/api/auth/register").send(validUser);

      const res = await agent.post("/api/auth/logout");

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Logout Succesfully");
      expect(res.headers["set-cookie"]![0]).toMatch(/token=;/);
    });
  });
});
