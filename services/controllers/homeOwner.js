import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { ObjectId } from "mongodb";
import { getDb } from "../db/db.js";
import "dotenv/config";

const router = express.Router();
const JWT_SECRET =
  process.env.JWT_SECRET || "s4fG-21pLm!x@t$Q&eF1K9dP7^rtyh9!YvBn#MjKlZ3UwCx";

if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET must be defined in the environment variables or fallback"
  );
}

// Middleware for token authentication
const authenticateToken = (req, res, next) => {
  const token =
    req.headers["authorization"] && req.headers["authorization"].split(" ")[1]; // Extract token

  if (!token) {
    return res.status(403).json({ error: "Access denied. Token missing." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Access denied. Invalid token." });
    }

    req.user = user;
    next(); // Proceed to the next middleware or route handler
  });
};

function convertDecimal128FieldsToString(data) {
  if (Array.isArray(data)) {
    return data.map(convertDecimal128FieldsToString);
  }

  if (typeof data === "object" && data !== null) {
    const newData = {};

    for (const key in data) {
      if (typeof data[key] === "object" && data[key] !== null) {
        if ("$numberDecimal" in data[key]) {
          newData[key] = data[key]["$numberDecimal"]; // Extract the actual number
        } else {
          newData[key] = convertDecimal128FieldsToString(data[key]); // Recursively process objects
        }
      } else {
        newData[key] = data[key];
      }
    }

    return newData;
  }

  return data;
}

// =========================== LOGIN AND LOGOUT ROUTES ===========================

// User Login Route
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const dbClient = getDb();
    const user = await dbClient
      .collection("users")
      .findOne({ usr_username: username });

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.usr_password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign({ userId: user.usr_id }, JWT_SECRET, {
      expiresIn: "1h",
    });

    res.status(200).json({
      message: "Login successful",
      user: { usr_id: user.usr_id, usr_first_name: user.usr_first_name },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "An error occurred while logging in." });
  }
});

// User Logout Route
router.post("/logout", (req, res) => {
  res.status(200).json({ message: "Logout successful" });
});

// =========================== USER PROFILE ROUTES ===========================

router.get("/header/:userId", async (req, res) => {
  const { userId } = req.params;
  console.log("user fetch", userId);
  try {
    console.log("Fetching user data for userId:", userId);
    const dbClient = getDb();
    const user = await dbClient.collection("users").findOne({ usr_id: userId });

    if (!user) {
      console.log("User not found:", userId);
      return res.status(404).json({ error: "User not found." });
    }

    res.json({
      userFirstName: user.usr_first_name,
      userLastName: user.usr_last_name,
      userUsername: user.usr_username,
      userPhone: user.usr_phone,
      userEmail: user.usr_email,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user profile." });
  }
});

// Update User Profile

// =========================== PROPERTY ROUTES ===========================

router.get("/properties/:userId", async (req, res) => {
  const { userId } = req.params; // Extract userId from JWT payload
  console.log(`Received userId: '${userId}'`); // Log userId for debugging

  try {
    const dbClient = getDb();

    // Query using `prop_owner_id` as a string
    const query = { prop_owner_id: userId.trim() };

    console.log("Constructed query:", query); // Log the constructed query

    // Fetch properties
    const properties = await dbClient
      .collection("properties")
      .find(query)
      .toArray();

    if (!properties.length) {
      console.log(`No properties found for userId: ${userId}`);
      return res.status(200).json({ properties: [] });
    }

    // console.log(`Found properties for userId: ${userId}`, properties); // Debugging
    res.status(200).json({ properties });
  } catch (error) {
    console.error("Error fetching properties:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching properties." });
  }
});

const convertDecimalToNumber = (value) => {
  if (value && value.$numberDecimal) {
    return parseFloat(value.$numberDecimal);
  }
  return value;
};

router.get("/properties-by-propId/:propId", async (req, res) => {
  const { propId } = req.params;
  try {
    const dbClient = getDb();

    if (!ObjectId.isValid(propId)) {
      return res.status(400).json({ error: "Invalid property ID format." });
    }

    const property = await dbClient
      .collection("properties")
      .findOne({ _id: new ObjectId(propId) });
    if (!property) {
      return res.status(404).json({ error: "Property not found." });
    }
    const billingStatements = await dbClient
      .collection("statements")
      .find({ bll_prop_id: property.prop_id, bll_pay_stat: "pending" })
      .toArray();
    const convertDecimal = (value) => {
      if (value && value.$numberDecimal) {
        return parseFloat(value.$numberDecimal);
      }
      return value || 0;
    };
    const billingStatementsData = JSON.parse(JSON.stringify(billingStatements));
    const data = convertDecimal128FieldsToString(billingStatementsData);

    const currentBill = data.length > 0 ? data[data.length - 1] : null;
    const convertedProperty = {
      ...property,
      prop_curr_amt_due: convertDecimal(currentBill?.bll_total_amt_due || 0),
      prop_curr_hoamaint_fee: convertDecimal(
        currentBill?.bll_hoamaint_fee || 0
      ),
      prop_curr_water_charges: convertDecimal(
        currentBill?.bll_water_charges || 0
      ),
      prop_curr_garb_fee: convertDecimal(currentBill?.bll_garb_charges || 0),
      billingStatements: data,
    };

    res.status(200).json(convertedProperty);
  } catch (error) {
    res.status(500).json({ error: "Error fetching property details." });
  }
});

// =========================== BILLING STATEMENTS ROUTES ===========================

// Fetch Billing Statements for a User
// router.get('/statements',  async (req, res) => {
//     const { userId } = req.query; // Extract userId from JWT payload
//     console.log(`Received userId: '${userId}'`); // Log userId for debugging

//     try {
//         const dbClient = getDb();

//         // Query the `properties` collection to find the `prop_owner` ObjectId
//         const property = await dbClient.collection('properties').findOne({ prop_owner_id: userId.trim() });

//         if (!property) {
//             console.log(`No property found for userId: ${userId}`);
//             return res.status(404).json({ error: 'No properties found for this user.' });
//         }

//         const propOwnerId = property.prop_owner; // Retrieve the ObjectId for the owner

//         console.log('Found propOwnerId:', propOwnerId); // Log the retrieved ObjectId

//         // Query the `statements` collection using the `prop_owner` ObjectId
//         const query = { bll_user_rec: propOwnerId }; // Match the correct ObjectId
//         const statements = await dbClient.collection('statements').find(query).toArray();

//         if (!statements.length) {
//             console.log(`No statements found for propOwnerId: ${propOwnerId}`);
//             return res.status(200).json({ statements: [] });
//         }

//         console.log(`Found statements for propOwnerId: ${propOwnerId}`, statements); // Debugging
//         res.status(200).json({ statements });
//     } catch (error) {
//         console.error('Error fetching statements:', error);
//         res.status(500).json({ error: 'An error occurred while fetching statements.' });
//     }
// });

router.get("/statements/:propId", async (req, res) => {
  const { propId } = req.params; // Extract userId from JWT payload
  console.log("propId", propId);
  try {
    const dbClient = getDb();

    // Query the `properties` collection to find the `prop_owner` ObjectId
    const property = await dbClient
      .collection("properties")
      .findOne({ _id: new ObjectId(propId) });

    if (!property) {
      console.log(`No property found for userId: ${propId}`);
      return res
        .status(404)
        .json({ error: "No properties found for this user." });
    }

    // Query the `statements` collection using the `prop_owner` ObjectId
    const query = { bll_prop_id: property.prop_id }; // Match the correct ObjectId
    const statements = await dbClient
      .collection("statements")
      .find(query)
      .toArray();

    if (!statements.length) {
      return res.status(200).json({ statements: [] });
    }

    console.log(`Found statements for ${propId}`, statements); // Debugging
    res.status(200).json({ statements });
  } catch (error) {
    console.error("Error fetching statements:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching statements." });
  }
});

// =========================== DASHBOARD ROUTE ===========================

// Fetch User Dashboard Data
router.get("/dashboard/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const dbClient = getDb();
    const user = await dbClient.collection("users").findOne({ usr_id: userId });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const properties = await dbClient
      .collection("properties")
      .find({ prop_owner: user._id })
      .toArray();
    const walletData = await dbClient
      .collection("wallet")
      .findOne({ wall_owner: userId });

    const response = {
      userFirstName: user.usr_first_name,
      userLastName: user.usr_last_name,
      properties: properties.map((property) => ({
        propLotNum: property.prop_lot_num,
        totalDues: property.prop_curr_amt_due
          ? parseFloat(property.prop_curr_amt_due.toString()).toFixed(2)
          : "0.00",
      })),
      walletBalance: walletData?.wall_bal
        ? parseFloat(walletData.wall_bal.toString())
        : 0,
      wall_adv_hoa_pay: walletData?.wall_adv_hoa_pay
        ? parseFloat(walletData.wall_adv_hoa_pay.toString())
        : 0,
      wall_adv_water_pay: walletData?.wall_adv_water_pay
        ? parseFloat(walletData.wall_adv_water_pay.toString())
        : 0,
      wall_adv_garb_pay: walletData?.wall_adv_garb_pay
        ? parseFloat(walletData.wall_adv_garb_pay.toString())
        : 0,
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching dashboard data." });
  }
});

// =========================== TRANSACTION ROUTES ===========================

// Fetch Transactions for a User
// router.get('/transaction/:userId',  async (req, res) => {
//     const { userId } = req.params;

//     try {
//         const dbClient = getDb();
//         const transactions = await dbClient.collection('transactions').find({ trn_user_init: userId }).toArray();

//         res.json(transactions);
//     } catch (error) {
//         console.error('Error fetching transactions:', error);
//         res.status(500).json({ error: 'An error occurred while fetching transactions.' });
//     }
// });

// Route to get transaction history for a user
router.get("/transaction/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const dbClient = getDb();
    const transactions = await dbClient
      .collection("transactions")
      .find({ trn_user_init: userId })
      .toArray();

    // Format transactions for frontend
    const formattedTransactions = transactions.map((trn) => ({
      transactionId: trn.trn_id || "N/A",
      date: trn.trn_created_at
        ? new Date(trn.trn_created_at).toLocaleDateString()
        : "Unknown Date",
      status: trn.trn_status || "Unknown",
      purpose: trn.trn_purp || "N/A",
      paymentMethod: trn.trn_method || "N/A",
      paymentAmount: trn.trn_amount || 0,
      reason: trn?.trn_reason || "",
    }));

    res.status(200).json(formattedTransactions);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching transactions." });
  }
});

// =========================== REPORT ROUTES ===========================

// Create a Report
router.post("/report", async (req, res) => {
  const { rpt_title, rpt_desc, rpt_image_url, rpt_type } = req.body;
  const { userId } = req.query;

  if (!rpt_title || !rpt_desc) {
    return res
      .status(400)
      .json({ error: "Title and description are required." });
  }

  try {
    const dbClient = getDb();
    const report = {
      rpt_user: userId,
      rpt_title,
      rpt_desc,
      rpt_image_url: rpt_image_url || "",
      rpt_created_at: new Date(),
      rpt_status: "open",
      rpt_type,
    };

    const result = await dbClient.collection("reports").insertOne(report);
    res
      .status(201)
      .json({
        message: "Report created successfully.",
        reportId: result.insertedId,
      });
  } catch (error) {
    console.error("Error creating report:", error);
    res.status(500).json({ error: "An error occurred while creating report." });
  }
});

// Utility function to generate JWT token
function generateAuthToken(user) {
  const secretKey = process.env.JWT_SECRET_KEY;
  const token = jwt.sign(
    { _id: user._id, username: user.usr_username },
    secretKey,
    { expiresIn: "1h" }
  );
  return token;
}

// Fetch user profile by ID
router.get("/profile/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const dbClient = getDb();
    const userData = await dbClient
      .collection("users")
      .findOne({ usr_id: userId });

    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      userFirstName: userData.usr_first_name,
      userLastName: userData.usr_last_name,
      userUsername: userData.usr_username,
      userPhone: userData.usr_phone,
      userEmail: userData.usr_email,
      userProfile: userData.usr_profile_photo,
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching user data" });
  }
});

// Update user profile
router.put("/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  const {
    usr_first_name,
    usr_last_name,
    usr_phone,
    usr_email,
    new_password,
    new_imageUrl,
    usr_username,
  } = req.body;
  try {
    const dbClient = getDb();
    let newPassword;

    if (new_password) {
      const hashPwd = await bcrypt.hash(new_password, 16);
      newPassword = hashPwd;
    }

    let updateField = {
      usr_first_name,
      usr_last_name,
      usr_phone,
      usr_username,
      usr_email,
      usr_profile_photo: new_imageUrl,
      usr_password: newPassword ?? undefined,
    };

    updateField = Object.fromEntries(
      Object.entries({
        usr_first_name,
        usr_last_name,
        usr_phone,
        usr_username,
        usr_email,
        usr_profile_photo: new_imageUrl,
        usr_password: newPassword ?? undefined,
      }).filter(
        ([_, value]) =>
          value !== undefined &&
          value !== null &&
          value.toString().trim() !== ""
      )
    );

    const userExist = await dbClient
      .collection("users")
      .findOne({ usr_username });

    if ((userExist || userExist?.usr_id) && userExist.usr_id != userId) {
      return res.status(400).json({ message: "Username already exist" });
    }

    const result = await dbClient.collection("users").updateOne(
      { usr_id: userId },
      {
        $set: updateField,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/profile/:userId/password", async (req, res) => {
  const { userId } = req.params;
  const { new_password } = req.body;
  try {
    const dbClient = getDb();

    if (!new_password) {
      return res.status(400).json({ message: "Password is required" });
    }

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const hashPwd = await bcrypt.hash(new_password, 16);

    let updateField = {
      usr_password: hashPwd,
    };

    const userExist = await dbClient
      .collection("users")
      .findOne({ usr_id: userId });

    if (!userExist || userExist.usr_role != "homeowner") {
      return res.status(404).json({ message: "User not found" });
    }

    const result = await dbClient.collection("users").updateOne(
      { usr_id: userId },
      {
        $set: updateField,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Utility function to generate a unique 10-character ID
// Utility function to generate unique IDs with specific prefixes
const generateId = (prefix, uppercase = false) => {
  const randomString = Math.random().toString(36).substring(2, 12); // Generate 10 characters
  return `${prefix}${uppercase ? randomString.toUpperCase() : randomString}`;
};

// =========================== TRANSACTION ROUTES ===========================
// router.post('/transactions/:propId',  async (req, res) => {
//     try {
//         const { propId } = req.params;
//         const {
//             trn_type,
//             trn_user_init,
//             trn_created_at,
//             trn_purp,
//             trn_method,
//             trn_amount,
//             trn_image_url,
//             bill_id
//         } = req.body;

//         console.log(req.body)
//         if (!trn_type || !trn_purp || !trn_method || (trn_purp !== "All" && !trn_amount)|| !trn_image_url || !bill_id) {
//             return res.status(400).json({ message: 'Missing required fields.' });
//         }

//         const dbClient = getDb();

//         if (!ObjectId.isValid(propId)) {
//             return res.status(400).json({ message: 'Invalid property ID.' });
//         }

//         const property = await dbClient.collection('properties').findOne({ _id: new ObjectId(propId) });
//         if (!property) {
//             return res.status(404).json({ message: 'Property not found.' });
//         }

//         // Generate a unique transaction ID with mixed case characters
//         const trn_id = generateId('CVT');

//         const transaction = {
//             trn_id,
//             trn_type,
//             trn_user_init,
//             trn_created_at: new Date(trn_created_at),
//             trn_purp,
//             trn_method,
//             trn_amount: parseFloat(trn_amount),
//             trn_status: 'pending',
//             trn_image_url,
//             bill_id
//         };

//         await dbClient.collection('transactions').insertOne(transaction);

//         res.status(201).json({
//             message: 'Transaction created successfully.',
//             transactionId: trn_id,
//         });
//     } catch (error) {
//         console.error('Error creating transaction:', error);
//         res.status(500).json({ message: 'Internal server error.' });
//     }
// });

router.post("/transactions/:propId", async (req, res) => {
  try {
    const { propId } = req.params;
    const {
      trn_type,
      trn_user_init,
      trn_created_at,
      trn_purp,
      trn_method,
      trn_amount,
      trn_image_url,
      bill_id,
    } = req.body;

    if (!trn_type || !trn_purp || !trn_method || !bill_id) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    if (
      trn_purp !== "All" &&
      (trn_amount === undefined || isNaN(parseFloat(trn_amount)))
    ) {
      return res.status(400).json({ message: "Invalid transaction amount." });
    }

    const dbClient = getDb();
    const bill = await dbClient
      .collection("statements")
      .findOne({ bll_id: bill_id });

    if (!bill) {
      return res.status(404).json({ message: "Billing statement not found." });
    }

    const trn_id = generateId("CVT");
    const paymentAmount = parseFloat(trn_amount);

    let newPaidBreakdown = { ...bill.bll_paid_breakdown };
    let newTotalPaid = (parseFloat(bill.bll_total_paid) || 0) + paymentAmount;
    console.log("wallet not found")

    if (trn_method === "E-Wallet") {
      const eWallet = await dbClient
        .collection("wallet")
        .findOne({ wall_owner: trn_user_init });
      if (!eWallet) {
        return res.status(400).json({ message: "E-Wallet not found." });
      }
      if (eWallet.wall_bal < paymentAmount) {
        return res
          .status(400)
          .json({ message: "Insufficient E-Wallet balance." });
      }

      await dbClient
        .collection("wallet")
        .updateOne(
          { wall_owner: trn_user_init },
          { $inc: { wall_bal: -paymentAmount } }
        );

      const villWalletCollection = dbClient.collection("villwallet");

      const villageWallet = await villWalletCollection.findOne();
      await villWalletCollection.updateOne(
        { villwall_id: villageWallet.villwall_id },
        { $inc: { villwall_tot_bal: parseFloat(paymentAmount) } }
      );
    }

    if (trn_purp === "Water Bill") {
      newPaidBreakdown.water = (bill.bll_paid_breakdown?.water || 0) + paymentAmount;
      } else if (trn_purp === "HOA Maintenance Fees") {
          newPaidBreakdown.hoa = (bill.bll_paid_breakdown?.hoa || 0) + paymentAmount;
      } else if (trn_purp === "Garbage") {
          newPaidBreakdown.garbage = (bill.bll_paid_breakdown?.garbage || 0) + paymentAmount;
      } else if (trn_purp === "All") {
      // Get total remaining balance per category
      const remainingWater = bill.bll_water_charges - (bill.bll_paid_breakdown?.water || 0);
      const remainingHOA = bill.bll_hoamaint_fee - (bill.bll_paid_breakdown?.hoa || 0);
      const remainingGarbage = bill.bll_garb_charges - (bill.bll_paid_breakdown?.garbage || 0);
  
      // Calculate total remaining balance
      const totalRemaining = remainingWater + remainingHOA + remainingGarbage;
  
      if (totalRemaining > 0) {
          // Calculate proportional payments
          const waterShare = parseFloat((remainingWater / totalRemaining) * paymentAmount).toFixed(2);
          const hoaShare = parseFloat((remainingHOA / totalRemaining) * paymentAmount).toFixed(2);
          const garbageShare = parseFloat((remainingGarbage / totalRemaining) * paymentAmount).toFixed(2);
  
          // Add to existing payments, ensuring no overpayment
          newPaidBreakdown.water = (bill.bll_paid_breakdown?.water || 0) + Math.min(waterShare, remainingWater);
          newPaidBreakdown.hoa = (bill.bll_paid_breakdown?.hoa || 0) + Math.min(hoaShare, remainingHOA);
          newPaidBreakdown.garbage = (bill.bll_paid_breakdown?.garbage || 0) + Math.min(garbageShare, remainingGarbage);
      }
  }

    const isWaterPaid = newPaidBreakdown.water >= bill.bll_water_charges;
    const isHoaPaid = newPaidBreakdown.hoa >= bill.bll_hoamaint_fee;
    const isGarbagePaid = newPaidBreakdown.garbage >= bill.bll_garb_charges;

    const newPayStat =
      isWaterPaid &&
      isHoaPaid &&
      isGarbagePaid &&
      newTotalPaid >= parseFloat(bill.bll_total_amt_due)
        ? "paid"
        : "pending";

    const transaction = {
      trn_id,
      trn_type,
      trn_user_init,
      trn_created_at: new Date(trn_created_at),
      trn_purp,
      trn_method,
      trn_amount: paymentAmount,
      trn_status: trn_method === "E-Wallet" ? 'completed' : "pending",
      trn_image_url,
      bill_id,
    };

    await dbClient.collection("transactions").insertOne(transaction);

    const transactions = await dbClient
      .collection("transactions")
      .find({ bill_id: bill_id }).toArray();

    const totalAmountOfAllTransactions = transactions.reduce((val, t) => {
      if (t.trn_status === "completed") return t.trn_amount + val;

      return val;
    }, 0);

    await dbClient.collection("statements").updateOne(
      { bll_id: bill_id },
      {
        $set: {
          bll_total_paid: newTotalPaid.toFixed(2),
          bll_pay_stat: newPayStat,
          bll_paid_breakdown: newPaidBreakdown,
          transactions_status:
           (( newPayStat == "paid") &&
           ( totalAmountOfAllTransactions >= bill.bll_total_paid &&
            totalAmountOfAllTransactions >= bill.bll_total_amt_due))
              ? "completed"
              : "pending",
        },
      },
      { upsert: true }
    );

    res.status(201).json({
      message:
        "Transaction created and billing statement updated successfully.",
      transactionId: trn_id,
    });
  } catch (error) {
    console.error("Error processing transaction:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// =========================== WALLET ROUTES ===========================
router.post("/wallet", async (req, res) => {
  try {
    console.log("Received wallet creation request:", req.body); // Log request data
    const {
      wall_owner,
      wall_adv_water_pay = 0.0,
      wall_adv_hoa_pay = 0.0,
      wall_adv_garb_pay = 0.0,
    } = req.body;

    if (!wall_owner) {
      return res
        .status(400)
        .json({ message: "Missing wallet owner (user ID)." });
    }

    const dbClient = getDb();
    const existingWallet = await dbClient
      .collection("wallet")
      .findOne({ wall_owner });

    if (existingWallet) {
      return res
        .status(400)
        .json({ message: "Wallet already exists for this user." });
    }

    const wall_id = generateId("CVW"); // Generate unique wallet ID

    const newWallet = {
      wall_id,
      wall_owner,
      wall_bal: 0.0,
      wall_adv_water_pay: parseFloat(wall_adv_water_pay),
      wall_adv_hoa_pay: parseFloat(wall_adv_hoa_pay),
      wall_adv_garb_pay: parseFloat(wall_adv_garb_pay),
      wall_created_at: new Date(),
      wall_updated_at: new Date(),
    };

    await dbClient.collection("wallet").insertOne(newWallet);

    res
      .status(201)
      .json({ message: "Wallet created successfully.", wallet: newWallet });
  } catch (error) {
    console.error("Error creating wallet:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});
router.get("/dashboard", async (req, res) => {
  const { userId } = req.query;

  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }
    if (!userId) {
      return res.status(400).json({ error: "userId Not Found" });
    }
    const statementCollections = database.collection("statements");
    const userCollections = database.collection("users");
    const walletCollection = database.collection("wallet");

    // Get the first and last day of the current month

    const currentUser = await userCollections.findOne({ usr_id: userId });
    const wallet = await walletCollection.findOne({ wall_owner: userId });

    if (!currentUser) {
      return res.status(404).json({ error: "User Not Found" });
    }

    if (!wallet) {
      return res.status(404).json({ error: "Wallet Not Found" });
    }

    const walletData = convertDecimal128FieldsToString(
      JSON.parse(JSON.stringify(wallet))
    );

    // Fetch transactions only for the current month using 'trn_created_at'
    const statements = await statementCollections.find().toArray();
    const billSummary = statements.reduce(
      (current, statement) => {
        if (statement.bll_user_rec.toString() == currentUser?._id.toString()) {
          // computing all the bills that you already pay
          if ("bll_paid_breakdown" in statement) {
            current.billsHaveBeenPaid.total +=
              parseFloat(statement?.bll_paid_breakdown?.water) +
              parseFloat(statement?.bll_paid_breakdown?.hoa) +
              parseFloat(statement?.bll_paid_breakdown?.garbage);
            current.billsHaveBeenPaid.garbage +=
              parseFloat(statement?.bll_paid_breakdown?.garbage) || 0;
            current.billsHaveBeenPaid.hoa +=
              parseFloat(statement?.bll_paid_breakdown?.hoa) || 0;
            current.billsHaveBeenPaid.water +=
              parseFloat(statement?.bll_paid_breakdown?.water) || 0;
          }

          // computing all the bills
          current.initialAmounts.total +=
            parseFloat(statement?.bll_water_charges) +
            parseFloat(statement?.bll_hoamaint_fee) +
            parseFloat(statement?.bll_garb_charges);
          current.initialAmounts.garbage +=
            parseFloat(statement?.bll_garb_charges) || 0;
          current.initialAmounts.hoa +=
            parseFloat(statement?.bll_hoamaint_fee) || 0;
          current.initialAmounts.water +=
            parseFloat(statement?.bll_water_charges) || 0;
        }

        return current;
      },
      {
        billsHaveBeenPaid: { garbage: 0, hoa: 0, water: 0, total: 0 },
        initialAmounts: { garbage: 0, hoa: 0, water: 0, total: 0 },
      }
    );

    res.status(200).json({ billSummary, wallet: walletData });
  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;
