import dotenv from "dotenv";

// Load test environment variables once
dotenv.config({ path: ".env.test", quiet: true });

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ||= "test-secret";
process.env.CORS_ORIGIN ||= "http://localhost:3000";
