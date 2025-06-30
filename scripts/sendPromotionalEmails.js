const mongoose = require("mongoose");
const User = require("../models/User");
const { sendEmail } = require("../services/emailService");
const config = require("../config/env");

/**
 * Fetches all users and sends them a promotional email.
 * This function is designed to be called by a cron job.
 */
const sendPromotionalEmails = async () => {
  console.log("🚀 Starting promotional email script...");

  try {
    // Find all users who have not opted out (if you add such a feature later)
    const users = await User.find({}).lean();

    if (users.length === 0) {
      console.log("ℹ️ No users found to send emails to.");
      return;
    }

    console.log(`✉️ Preparing to send emails to ${users.length} users...`);

    for (const user of users) {
      const emailOptions = {
        to: user.email,
        subject: "🔥 Hot New Odds and Promotions at BetWise! 🔥",
        html: `
          <div style="font-family: Arial, sans-serif; line-height: 1.6;">
            <h2>Hi ${user.firstName},</h2>
            <p>This week is packed with exciting matches and we've got some special promotions just for you!</p>
            <p>Check out the latest odds on the Premier League and don't miss our new <strong>Odds Boost</strong> promotion in the Promotions tab.</p>
            <p>Ready to place your bets?</p>
            <a href="${config.FRONTEND_URL}" style="background-color: #28a745; color: white; padding: 12px 25px; text-align: center; text-decoration: none; display: inline-block; border-radius: 5px; font-size: 16px;">Go to BetWise</a>
            <p style="margin-top: 20px;">Best of luck!</p>
            <p><em>- The BetWise Team</em></p>
          </div>
        `,
      };

      // Use the existing email service to send the email
      await sendEmail(emailOptions);
    }

    console.log(`✅ Successfully sent emails to ${users.length} users.`);
  } catch (error) {
    console.error(
      "❌ An error occurred during the promotional email script:",
      error
    );
  }
};

module.exports = { sendPromotionalEmails };
