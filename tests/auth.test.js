// In: Bet/Backend/tests/auth.test.js
// This is a new file to test the authentication endpoints.

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../index"); // Your main Express app
const User = require("../models/User");
const config = require("../config/env");

describe("Auth Endpoints", () => {
  // Connect to the test database before running any tests
  beforeAll(async () => {
    const dbUri = config.MONGODB_TEST_URI;
    await mongoose.connect(dbUri);
  });

  // Clean up the user collection and disconnect after all tests are done
  afterAll(async () => {
    await User.deleteMany({});
    await mongoose.disconnect();
  });

  const testUser = {
    username: "testregisteruser",
    email: "testregister@example.com",
    password: "Password123!",
    firstName: "Test",
    lastName: "User",
  };

  describe("POST /auth/register", () => {
    it("should register a new user successfully", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.username).toBe(testUser.username);
    });

    it("should fail to register a user with an existing email", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({ ...testUser, username: "anotheruser" }); // Same email, different username

      expect(res.statusCode).toBe(400);
      expect(res.body.msg).toBe("Username or email already exists.");
    });

    it("should fail to register a user with a short password", async () => {
      const res = await request(app)
        .post("/api/v1/auth/register")
        .send({ ...testUser, email: "newemail@example.com", password: "123" });

      expect(res.statusCode).toBe(400);
      expect(res.body.errors).toBeInstanceOf(Array);
      expect(res.body.errors[0].msg).toContain(
        "Password must be at least 6 characters long."
      );
    });
  });

  describe("POST /auth/login", () => {
    it("should log in an existing user successfully", async () => {
      const res = await request(app).post("/api/v1/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body.user.email).toBe(testUser.email);
    });

    it("should fail to log in with an incorrect password", async () => {
      const res = await request(app).post("/api/v1/auth/login").send({
        email: testUser.email,
        password: "wrongpassword",
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.msg).toBe("Incorrect password. Please try again.");
    });

    it("should fail to log in with a non-existent email", async () => {
      const res = await request(app).post("/api/v1/auth/login").send({
        email: "nonexistent@example.com",
        password: "somepassword",
      });

      expect(res.statusCode).toBe(401);
      expect(res.body.msg).toBe("No account found with that email address.");
    });
  });
});
