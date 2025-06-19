const mongoose = require("mongoose");
const axios = require("axios");
const User = require("../models/User");
const Bet = require("../models/Bet");
const { sendEmail } = require("../services/emailService");
const config = require("../config/env"); // <-- IMPORT the new config

const ML_MODEL_API_URL = config.ML_MODEL_API_URL; // <-- USE config

async function analyzeUsers() {
  console.log("🚀 Starting ML-Powered Responsible Gambling analysis script...");
  const dbUri = config.MONGODB_URI; // <-- USE config

  if (!dbUri) {
    console.error("❌ Error: MONGODB_URI is not defined.");
    process.exit(1);
  }

  if (!ML_MODEL_API_URL) {
    console.error(
      "❌ Error: ML_MODEL_API_URL is not defined in your .env file."
    );
    process.exit(1);
  }

  console.log("DATABASE_URI:", dbUri);
  await mongoose.connect(dbUri);
  console.log("✅ MongoDB connected.");

  try {
    const users = await User.find({});
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const user of users) {
      const recentBets = await Bet.find({
        user: user._id,
        createdAt: { $gte: twentyFourHoursAgo },
      });

      if (recentBets.length === 0) {
        if (user.responsibleGambling.status === "at_risk") {
          user.responsibleGambling.status = "ok";
          user.responsibleGambling.riskFactors = [];
          await user.save();
          console.log(
            `ℹ️ User ${user.username} status reset to 'ok' due to inactivity.`
          );
        }
        continue;
      }

      const totalStaked = recentBets.reduce((sum, bet) => sum + bet.stake, 0);
      const betCount = recentBets.length;
      const averageStake = totalStaked / betCount;

      const features = {
        bet_count_24h: betCount,
        total_staked_24h: totalStaked,
        average_stake_24h: averageStake,
      };

      try {
        console.log(
          `- Analyzing user ${user.username} with features:`,
          features
        );
        const predictionResponse = await axios.post(ML_MODEL_API_URL, features);
        const prediction = predictionResponse.data;

        user.responsibleGambling.lastChecked = new Date();
        if (prediction && prediction.is_at_risk) {
          // 2. IF USER IS FLAGGED AND WAS NOT FLAGGED BEFORE, SEND AN EMAIL
          if (user.responsibleGambling.status !== "at_risk") {
            const emailSubject = "A friendly check-in from BetWise";
            const emailMessage = `
              <div style="font-family: Arial, sans-serif; color: #333;">
                <h2>Hello ${user.firstName},</h2>
                <p>We're just checking in. We noticed you've been more active on BetWise lately.</p>
                <p>We want to remind you that we have tools available to help you stay in control of your play. You can set weekly limits on your bets and stakes at any time in your account settings.</p>
                <p>Playing should always be fun. If you ever feel like you need a break, these tools are here for you.</p>
                <p>Best regards,<br>The BetWise Team</p>
              </div>
            `;
            await sendEmail({
              to: user.email,
              subject: emailSubject,
              html: emailMessage,
            });
            console.log(
              `📧 Proactive responsible gambling email sent to ${user.email}.`
            );
          }

          user.responsibleGambling.status = "at_risk";
          user.responsibleGambling.riskFactors = [
            prediction.reason || "ML model flagged as at-risk",
          ];
          console.log(
            `⚠️  ML Model flagged user ${
              user.username
            } as 'at_risk'. Reason: ${user.responsibleGambling.riskFactors.join(
              ", "
            )}`
          );
        } else {
          user.responsibleGambling.status = "ok";
          user.responsibleGambling.riskFactors = [];
        }

        await user.save();
      } catch (mlError) {
        console.error(
          `❌ Error calling ML model for user ${user.username}:`,
          mlError.code || mlError.message
        );
      }
    }

    console.log("✅ ML-Powered analysis complete.");
  } catch (error) {
    console.error(
      "❌ An error occurred during the main analysis process:",
      error
    );
  } finally {
    await mongoose.disconnect();
    console.log("ℹ️ MongoDB disconnected.");
  }
}

analyzeUsers();
