const { body, query, validationResult } = require("express-validator");
const mongoose = require("mongoose");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Withdrawal = require("../models/Withdrawal");
const {
  createPaymentLink,
  verifyWebhookSignature,
} = require("../services/paymentService");

// --- Validation Rules ---

exports.validateInitializeDeposit = [
  body("amount")
    .isFloat({ gt: 99 })
    .withMessage("Deposit amount must be at least 100 NGN.")
    .toFloat(),
];

exports.validateGetTransactionHistory = [
  query("type")
    .optional()
    .isIn([
      "bet",
      "win",
      "topup",
      "refund",
      "withdrawal",
      "admin_credit",
      "admin_debit",
    ]),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("page").optional().isInt({ min: 1 }),
];

exports.validateRequestWithdrawal = [
  body("amount")
    .isFloat({ gt: 0 })
    .withMessage("Withdrawal amount must be a positive number.")
    .toFloat(),
];

// --- Controller Functions ---

// Handles starting a deposit via Flutterwave
exports.initializeDeposit = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user._id);

    // 'paymentData' will be the object { link: "...", tx_ref: "..." }
    // Correct argument order
    const paymentData = await createPaymentLink(
      amount,
      user.email,
      user.fullName,
      user._id
    );

    // This is the new response structure that combines the old and new formats.
    res.status(200).json({
      message:
        "Payment link created successfully. Please Follow the link to process your transaction.",
      paymentLink: paymentData.link, // Keep the original 'paymentLink' field
      tx_ref: paymentData.tx_ref, // Add the new 'tx_ref' field
    });
  } catch (error) {
    next(error);
  }
};

exports.handleFlutterwaveWebhook = async (req, res, next) => {
  const signature = req.headers["verif-hash"];
  if (!signature || !verifyWebhookSignature(signature)) {
    return res.status(401).send("Unauthorized");
  }

  const payload = req.body;

  // The only check we need is if the payment status is "successful".
  if (payload.status === "successful") {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Use payload.txRef from the webhook data, which matches payload.data.tx_ref
      const tx_ref = payload.txRef || payload.data.tx_ref;
      const userId = tx_ref ? tx_ref.split("-")[2] : null;

      if (!userId) {
        throw new Error("Could not parse User ID from transaction reference.");
      }

      const amount = payload.amount || payload.data.amount;
      const user = await User.findById(userId).session(session);

      if (user) {
        user.walletBalance += amount;
        await user.save({ session });

        await new Transaction({
          user: user._id,
          type: "topup",
          amount: amount,
          balanceAfter: user.walletBalance,
          description: `Wallet top-up via Flutterwave. Ref: ${
            payload.flwRef || payload.data.flw_ref
          }`,
        }).save({ session });
      }
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      console.error("Webhook processing error:", error);
      return res.status(500).send("Error processing webhook.");
    } finally {
      session.endSession();
    }
  }

  res.status(200).send("Webhook received.");
};

exports.getWallet = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select("walletBalance username email")
      .lean();
    if (!user) {
      const err = new Error("User wallet data not found.");
      err.statusCode = 404;
      return next(err);
    }
    res.json({
      username: user.username,
      email: user.email,
      walletBalance: parseFloat(user.walletBalance.toFixed(2)),
    });
  } catch (error) {
    next(error);
  }
};

exports.getTransactionHistory = async (req, res, next) => {
  try {
    const { type, page = 1, limit = 10 } = req.query;
    const filter = { user: req.user._id };
    if (type) filter.type = type;

    const skip = (page - 1) * limit;
    const transactions = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .populate({ path: "game", select: "homeTeam awayTeam" })
      .populate({ path: "bet", select: "outcome stake" })
      .limit(limit)
      .skip(skip)
      .lean();

    const totalTransactions = await Transaction.countDocuments(filter);
    res.json({
      transactions,
      currentPage: page,
      totalPages: Math.ceil(totalTransactions / limit),
      totalCount: totalTransactions,
    });
  } catch (error) {
    next(error);
  }
};

exports.getWalletSummary = async (req, res, next) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user._id);

    // --- NEW LOGIC: Get the balance directly from the authenticated user object ---
    const currentWalletBalance = req.user.walletBalance || 0;
    // --- END NEW LOGIC ---

    const financialData = await Transaction.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: "$type",
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const summary = {
      totalTopUps: { amount: 0, count: 0 },
      totalBetsPlaced: { amount: 0, count: 0 },
      totalWinnings: { amount: 0, count: 0 },
      totalRefunds: { amount: 0, count: 0 },
      currentWalletBalance: currentWalletBalance, // Use the balance from the auth object
    };

    financialData.forEach((item) => {
      const amount = item.totalAmount || 0;
      const count = item.count || 0;
      switch (item._id) {
        case "topup":
        case "admin_credit":
          summary.totalTopUps.amount += amount;
          summary.totalTopUps.count += count;
          break;
        case "bet":
          summary.totalBetsPlaced.amount += Math.abs(amount);
          summary.totalBetsPlaced.count += count;
          break;
        case "win":
          summary.totalWinnings.amount += amount;
          summary.totalWinnings.count += count;
          break;
        case "refund":
        case "withdrawal":
        case "admin_debit":
          summary.totalRefunds.amount += Math.abs(amount);
          summary.totalRefunds.count += count;
          break;
      }
    });

    summary.netGamblingResult =
      summary.totalWinnings.amount - summary.totalBetsPlaced.amount;

    for (const key in summary) {
      if (
        summary[key] &&
        typeof summary[key] === "object" &&
        summary[key].hasOwnProperty("amount")
      ) {
        summary[key].amount = parseFloat(summary[key].amount.toFixed(2));
      } else if (typeof summary[key] === "number") {
        summary[key] = parseFloat(summary[key].toFixed(2));
      }
    }

    res.json(summary);
  } catch (error) {
    next(error);
  }
};

exports.requestWithdrawal = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      const err = new Error("User not found.");
      err.statusCode = 404;
      return next(err);
    }
    if (user.walletBalance < amount) {
      const err = new Error("Insufficient funds for withdrawal.");
      err.statusCode = 400;
      return next(err);
    }
    const existingPending = await Withdrawal.findOne({
      user: user._id,
      status: "pending",
    });
    if (existingPending) {
      const err = new Error("You already have a pending withdrawal request.");
      err.statusCode = 400;
      return next(err);
    }
    const withdrawalRequest = new Withdrawal({
      user: user._id,
      amount: amount,
    });
    await withdrawalRequest.save();
    res.status(201).json({
      msg: "Withdrawal request submitted successfully.",
      withdrawalRequest,
    });
  } catch (error) {
    next(error);
  }
};
