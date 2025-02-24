import express from "express";
import bcrypt from "bcryptjs";
import fs from "fs";
import tinify from "tinify";
import { ObjectId, Decimal128 } from "mongodb";
import { getDb } from "../db/db.js";
import "dotenv/config"; // Lo
const router = express.Router();

router.put("/update-status/:id", async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }

    const transactionCollection = database.collection("transactions");
    const billingCollection = database.collection("statements");

    const transaction = await transactionCollection.findOne({ trn_id: id });

    if (!transaction || !transaction._id) {
      console.error("Transaction not found:", id);
      return res.status(404).json({ error: "Transaction not found." });
    }

    const billingStatement = await billingCollection.findOne({
      bll_id: transaction.bill_id,
    });

    const updateFields = {
      trn_status: status,
      trn_reason: reason,
    };

    const result = await transactionCollection.updateOne(
      { trn_id: id },
      { $set: updateFields },
      { upsert: true }
    );

    // Check if all transactions for the bill have been paid
    const transactions = await transactionCollection
      .find({ bill_id: billingStatement.bll_id })
      .toArray();

    const totalAmountOfAllTransactions = transactions.reduce(
      (val, t) => { 
        if (t.trn_status === "completed") return t.trn_amount + val

        return val;
      },
      0
    );

    if (
      totalAmountOfAllTransactions >= billingStatement.bll_total_paid &&
      totalAmountOfAllTransactions >= billingStatement.bll_total_amt_due
    ) {
      await billingCollection.updateOne(
        { bll_id: billingStatement.bll_id },
        { $set: { transactions_status: "completed" } }
      );
      const villWalletCollection = database.collection("villwallet");
      const villageWallet = await villWalletCollection.findOne();

      const completedTransaction = transactions.find(t => t.trn_type === "Advanced Payment" && t.trn_status === "completed")
      // If it's an advanced payment, update wallets
      if (transactions.length > 0 && completedTransaction?.trn_type === "Advanced Payment") {
        const walletCollection = database.collection("wallet");

        const homeOwnerWallet = await walletCollection.findOne({ wall_owner: transaction.trn_user_init });

        if (!homeOwnerWallet) {
          console.error("Wallet not found for update.");
          return res.status(400).json({ error: "Wallet(s) not found." });
        }

        const exceedAmount = parseFloat(billingStatement.bll_total_paid) - parseFloat(billingStatement.bll_total_amt_due);
        
        // Update wallet balances using $inc
        await walletCollection.updateOne(
          { wall_id: homeOwnerWallet.wall_id, wall_owner: homeOwnerWallet.wall_owner },
          { $inc: { wall_bal: exceedAmount } }
        );
      }

      await villWalletCollection.updateOne(
        { villwall_id: villageWallet.villwall_id },
        { $inc: { villwall_tot_bal: parseFloat(billingStatement.bll_total_amt_due) } }
      );

    }

    return res.status(200).json({ result });
  } catch (err) {
    console.error("Error updating transaction status:", err);
    return res.status(500).json({ error: "Failed to update transaction status." });
  }
});

router.get("/", async (req, res) => {
  const { userId } = req.query;
  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }
    const transactionCollection = database.collection("transactions");

    const query = {};

    if (userId) query.trn_user_init = userId;
    
    const transactions = await transactionCollection.find(query).toArray();
    return res.status(200).json(transactions);
  } catch (err) {
    console.error("Error updating transaction status:", err);
    return res.status(500).json({ error: "*Failed to add a new rate" });
  }
});

export default router;
