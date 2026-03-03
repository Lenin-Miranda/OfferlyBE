import request from "supertest";
import app from "../app.js";
import { connectTestDB, closeTestDb, clearDatabase } from "./setup.js";

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
  describe("POST /auth/signup", () => {
    it("should create a new user with valid credentials", async () => {
      const res = await request(app).post("/auth/signup").send(validUser);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user).toHaveProperty("id");
      expect(res.body.user.email).toBe(validUser.email);
      expect(res.body.message).toBe("User Succesfully Registered");
    });

    it("should set httpOnly cookie on signup", async () => {
      const res = await request(app).post("/auth/signup").send(validUser);

      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.headers["set-cookie"]![0]).toMatch(/token=/);
      expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/);
    });

    it("should fail with missing email", async () => {
      const res = await request(app).post("/auth/signup").send({
        email: "",
        password: "12345678",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email and Password are required");
    });

    it("should fail with missing password", async () => {
      const res = await request(app).post("/auth/signup").send({
        email: "test@test.com",
        password: "",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email and Password are required");
    });

    it("should fail if email already exists", async () => {
      await request(app).post("/auth/signup").send(validUser);
      const res = await request(app).post("/auth/signup").send(validUser);

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Email is already in use");
    });
  });

  describe("POST /auth/login", () => {
    beforeEach(async () => {
      await request(app).post("/auth/signup").send(validUser);
    });

    it("should login with valid credentials", async () => {
      const res = await request(app).post("/auth/login").send(validUser);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.email).toBe(validUser.email);
      expect(res.body.message).toBe("Login Succesful");
    });

    it("should set httpOnly cookie on login", async () => {
      const res = await request(app).post("/auth/login").send(validUser);

      expect(res.headers["set-cookie"]).toBeDefined();
      expect(res.headers["set-cookie"]![0]).toMatch(/token=/);
      expect(res.headers["set-cookie"]![0]).toMatch(/HttpOnly/);
    });

    it("should fail with missing email", async () => {
      const res = await request(app).post("/auth/login").send({
        email: "",
        password: "12345678",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email and Password are required");
    });

    it("should fail with missing password", async () => {
      const res = await request(app).post("/auth/login").send({
        email: "test@test.com",
        password: "",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Email and Password are required");
    });

    it("should fail with unregistered email", async () => {
      const res = await request(app).post("/auth/login").send({
        email: "notfound@test.com",
        password: "12345678",
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Email not found Try Register");
    });

    it("should fail with incorrect password", async () => {
      const res = await request(app).post("/auth/login").send({
        email: validUser.email,
        password: "wrongpassword",
      });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid Credentials");
    });
  });

  describe("POST /auth/logout", () => {
    it("should clear cookie on logout", async () => {
      const signupRes = await request(app).post("/auth/signup").send(validUser);
      const token = signupRes.body.token;

      const res = await request(app)
        .post("/auth/logout")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Logout Succesfully");
      expect(res.headers["set-cookie"]![0]).toMatch(/token=;/);
    });
  });
});
