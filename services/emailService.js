const nodemailer = require("nodemailer");
const config = require("../config/env"); // <-- IMPORT the new config

const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    service: config.EMAIL_SERVICE, // <-- USE config
    auth: {
      user: config.EMAIL_USER, // <-- USE config
      pass: config.EMAIL_PASS, // <-- USE config
    },
  });

  const mailOptions = {
    from: `"${config.EMAIL_FROM_NAME}" <${
      config.EMAIL_USER // <-- USE config
    }>`,
    to: options.to,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${options.to}`);
  } catch (error) {
    console.error(`❌ Email could not be sent to ${options.to}:`, error);
    // In a real app, you might add more robust error handling or retries here.
    throw new Error(
      "Email could not be sent due to a server configuration issue."
    );
  }
};

module.exports = { sendEmail };
