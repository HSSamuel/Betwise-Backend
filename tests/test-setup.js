const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const config = require("../config/env");

let mongoServer;

const setup = async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
};

const teardown = async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
};

const createTestUser = async (userData) => {
  const user = new User(userData);
  await user.save();
  return user;
};

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, username: user.username },
    config.JWT_SECRET,
    { expiresIn: "1h" }
  );
};

module.exports = {
  setup,
  teardown,
  createTestUser,
  generateToken,
};
