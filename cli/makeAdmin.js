const User = require("../models/User");
const {
  connectToDB,
  disconnectDB,
  findUserByUsername,
} = require("./cliHelpers"); // <-- IMPORT the new helpers

async function makeUserAdmin(username) {
  const user = await findUserByUsername(username);

  if (user) {
    if (user.role === "admin") {
      console.log(`ℹ️ User "${user.username}" is already an admin.`);
    } else {
      user.role = "admin";
      await user.save();
      console.log(
        `✅ User "${user.username}" has been successfully promoted to admin.`
      );
    }
  }
}

async function main() {
  const inputUsername = process.argv[2];
  if (!inputUsername) {
    console.error(
      "❗ Please provide a username as an argument (e.g., node cli/makeAdmin.js <username>)"
    );
    process.exit(1);
  }

  try {
    await connectToDB(); // <-- USE helper
    await makeUserAdmin(inputUsername);
  } catch (error) {
    console.error("❌ An unexpected error occurred:", error.message);
  } finally {
    await disconnectDB(); // <-- USE helper
  }
}

main();
