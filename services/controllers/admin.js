// services/db/userRoutes.js
import express, { json } from "express";
import bcrypt from "bcryptjs";
import fs from "fs";
import tinify from "tinify";
import { ObjectId, Decimal128 } from "mongodb";
import "dotenv/config"; // Load environment variables

import { getDb } from "../db/db.js"; // Import the db module
import { sendWelcomeEmail } from "../welcomeEmail.js"; // Import sendWelcomeEmail from emailService

const router = express.Router();

tinify.key = process.env.TINIFY_API_KEY;

// ----
// HELPER FUNCTIONS
// ----
const generateId = (prefix, uppercase = false) => {
  const randomString = Math.random().toString(36).substring(2, 12); // Generate 10 characters
  return `${prefix}${uppercase ? randomString.toUpperCase() : randomString}`;
};
// Helper function to recursively convert Decimal128 fields to strings
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

// Helper function to generate a 6-digit OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // Generates a 6-digit OTP as a string
}

// Helper function to compress and upload an image
async function compressAndUploadBillImage(imageData, bll_id, timestamp) {
  const directory = "/var/www/assets/bill_proof";
  const cdnUrl = "https://cdn.cvconnect.app/bill_proof";

  // Ensure the directory exists
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  // Decode the base64 image
  const base64Data = imageData.split(";base64,").pop();
  const originalExtension = imageData.match(/data:image\/(\w+);base64/)[1]; // Get the file extension (e.g., png, jpg)

  // Create a temporary file for compression
  const tempFilePath = path.join(directory, `temp.${originalExtension}`);
  fs.writeFileSync(tempFilePath, base64Data, { encoding: "base64" });

  // Generate the new file name
  const formattedTimestamp = timestamp.toISOString().replace(/[:.]/g, "-"); // Format timestamp for filename
  const newFileName = `${bll_id}${formattedTimestamp}.${originalExtension}`;
  const newFilePath = path.join(directory, newFileName);

  try {
    // Compress the image with Tinify
    const source = tinify.fromFile(tempFilePath);
    await source.toFile(newFilePath);

    // Remove the temporary file
    fs.unlinkSync(tempFilePath);

    // Return the URL of the uploaded file
    return `${cdnUrl}/${newFileName}`;
  } catch (error) {
    console.error("Error compressing or uploading image:", error);
    throw new Error("Failed to process image");
  }
}

// ----
// LOGIN FUCNTIONS
// ----

// POST /api/login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const database = getDb();
    const usersCollection = database.collection("users");

    console.log("hello");
    if (!username || !password) {
      return res
        .status(401)
        .json({ error: "failed to submit required parameters" });
    }

    // Find the user by username
    const user = await usersCollection.findOne({ usr_username: username });

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Compare the provided password with the hashed password stored in the database
    const isPasswordValid = await bcrypt.compare(password, user.usr_password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // If valid, return the user object with relevant fields
    res.status(200).json({
      _id: user._id,
      usr_id: user.usr_id, // Custom user ID (e.g., 'CVU******')
      usr_username: user.usr_username,
      usr_email: user.usr_email,
      usr_role: user.usr_role,
      usr_profile_photo: user.usr_profile_photo,
    });
  } catch (err) {
    console.error("Error logging in:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----
// USER FUCNTIONS
// ----

// GET /api/users - Fetch all users
router.get("/users", async (req, res) => {
  try {
    const database = getDb(); // Get the database instance
    const usersCollection = database.collection("users"); // Access the 'users' collection
    const users = await usersCollection.find({}).toArray(); // Fetch all users from the collection
    res.json(users); // Send the user data as JSON
  } catch (err) {
    console.error("[SERVER] Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" }); // Handle errors
  }
});

// GET /api/users/:usr_id - Fetch a specific user by ID
router.get("/users/:usr_id", async (req, res) => {
  const { usr_id } = req.params; // Extract the usr_id from the URL

  try {
    const database = getDb(); // Get the database instance
    const usersCollection = database.collection("users"); // Access the 'users' collection

    // Use MongoDB aggregation to join the 'wallet' collection and retrieve the wallet balance
    const user = await usersCollection
      .aggregate([
        { $match: { usr_id: usr_id } }, // Match the user by usr_id
        {
          $lookup: {
            from: "wallet", // Join with the 'wallet' collection
            localField: "usr_wallet_bal", // Use the usr_wallet_bal (ObjectId) from users
            foreignField: "_id", // Match with _id in wallet collection
            as: "walletDetails", // Output array with wallet details
          },
        },
        { $unwind: "$walletDetails" }, // Unwind to access wallet fields directly
        {
          $project: {
            // Project the fields to return in the final output
            usr_id: 1,
            usr_first_name: 1,
            usr_last_name: 1,
            usr_age: 1,
            usr_date_of_birth: 1,
            usr_phone: 1,
            usr_email: 1,
            usr_role: 1,
            usr_username: 1,
            usr_profile_photo: 1,
            usr_wallet_bal: "$walletDetails.wall_bal", // Retrieve wall_bal from wallet
            // Add other fields you need here
          },
        },
      ])
      .toArray();

    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" }); // Handle case where user is not found
    }
    const data = JSON.parse(JSON.stringify(user[0]));
    // Convert all Decimal128 fields to strings, including nested ones
    const userResponse = convertDecimal128FieldsToString(data);
    res.status(200).json(userResponse);
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/create-account - Create user account with wallet
router.post("/create_account", async (req, res) => {
  const {
    first_name,
    last_name,
    age,
    date_of_birth,
    phone,
    email,
    role,
    username,
    password,
  } = req.body;

  const defProfPic = "https://cdn.cvconnect.app/cvprofile_default.jpg";
  const timestamp = new Date(); // Get the current date and time

  try {
    const hashedPassword = await bcrypt.hash(password, 16); // Hash the password

    // Check if the database connection is working
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }

    const usersCollection = database.collection("users");
    const walletCollection = database.collection("wallet"); // Access the wallet collection

    // Check if username already exists in the users collection
    const existingUser = await usersCollection.findOne({
      usr_username: username,
    });
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }

    // Generate a unique usr_id and ensure it doesn't exist in the database
    let user_id;
    let userExists;
    do {
      user_id = "CVU" + Math.random().toString(36).substring(2, 8);
      userExists = await usersCollection.findOne({ usr_id: user_id });
    } while (userExists); // Regenerate until a unique usr_id is found

    // Generate a unique wall_id and ensure it doesn't exist in the wallet collection
    let wall_id;
    let walletExists;
    do {
      wall_id = "CVW" + Math.random().toString(36).substring(2, 8);
      walletExists = await walletCollection.findOne({ wall_id: wall_id });
    } while (walletExists); // Regenerate until a unique wall_id is found

    // Generate a 6-digit OTP for first login verification
    const generatedOtp = generateOtp();

    // Create the wallet for the user
    const walletResult = await walletCollection.insertOne({
      wall_id: wall_id,
      wall_owner: user_id, // Link to the user's ID
      wall_bal: Decimal128.fromString("0.00"),
      wall_adv_water_pay: Decimal128.fromString("0.00"),
      wall_adv_hoa_pay: Decimal128.fromString("0.00"),
      wall_adv_garb_pay: Decimal128.fromString("0.00"),
      wall_created_at: timestamp,
      wall_updated_at: timestamp,
    });

    // Get the ObjectId of the newly created wallet document
    const walletObjectId = walletResult.insertedId;

    // Insert the new user account into MongoDB with reference to the wallet ObjectId
    await usersCollection.insertOne({
      usr_id: user_id,
      usr_first_name: first_name,
      usr_last_name: last_name,
      usr_age: age,
      usr_date_of_birth: date_of_birth,
      usr_phone: "+63" + phone,
      usr_email: email,
      usr_role: role,
      usr_username: username,
      usr_password: hashedPassword, // Save the hashed password
      usr_profile_photo: defProfPic,
      usr_wallet_bal: walletObjectId, // Link to the wallet's ObjectId
      usr_isverified: false,
      usr_otp: generatedOtp,
      usr_created_at: timestamp,
      usr_updated_at: timestamp,
    });

    // Send the welcome email to the new user's email address
    await sendWelcomeEmail(
      email,
      generatedOtp,
      first_name,
      last_name,
      username,
      password
    );

    res.status(200).json({ message: "Account created successfully" });
  } catch (err) {
    console.error("Error creating account:", err);
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.post("/users/:usr_id/edit-avatar", async (req, res) => {
  // Image upload to follow
});

router.post("/users/:usr_id/edit-profile", async (req, res) => {});

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
      }).filter(([_, value]) => value !== undefined && value !== null && value.toString().trim() !== "")
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

router.get('/properties-by-propId/:propId',  async (req, res) => {
  const { propId } = req.params;
  try {
      const dbClient = getDb();

      if (!ObjectId.isValid(propId)) {
          return res.status(400).json({ error: 'Invalid property ID format.' });
      }

      const property = await dbClient.collection('properties').findOne({ _id: new ObjectId(propId) });
      if (!property) {
        return res.status(404).json({ error: 'Property not found.' });
      }
      const billingStatements = await dbClient.collection("statements").find({bill_id: property.prop_id}).toArray()

      const data = JSON.parse(JSON.stringify(property));
      const propertyData = convertDecimal128FieldsToString(data);
      const convertDecimal = (value) => {
          if (value && value.$numberDecimal) {
              return parseFloat(value.$numberDecimal);
          }
          return value || 0;
      };
      
      const convertedProperty = {
          ...propertyData,
          prop_curr_amt_due: Number(propertyData.prop_curr_amt_due),
          prop_curr_hoamaint_fee: Number(propertyData.prop_curr_hoamaint_fee),
          prop_curr_water_charges: Number(propertyData.prop_curr_water_charges),
          prop_curr_garb_fee: Number(propertyData.prop_curr_garb_fee),
          billingStatements
      };

      res.status(200).json(convertedProperty);
  } catch (error) {
      res.status(500).json({ error: 'Error fetching property details.' });
  }
});

router.post('/transactions/:propId', async (req, res) => {
  try {
      const { propId } = req.params;
      const {
          trn_type,
          trn_user_init,
          trn_created_at,
          trn_purp,
          trn_method,
          trn_amount,
          trn_image_url="",
          bill_id
      } = req.body;

      if (!trn_type || !trn_purp || !trn_method || !bill_id) {
          return res.status(400).json({ message: 'Missing required fields.' });
      }

      if (trn_purp !== "All" && (trn_amount === undefined || isNaN(parseFloat(trn_amount)))) {
          return res.status(400).json({ message: 'Invalid transaction amount.' });
      }

      const dbClient = getDb();
      const bill = await dbClient.collection('statements').findOne({ bll_id: bill_id });

      if (!bill) {
          return res.status(404).json({ message: 'Billing statement not found.' });
      }

      const trn_id = generateId('CVT');
      const paymentAmount = parseFloat(trn_amount);

      let newPaidBreakdown = { ...bill.bll_paid_breakdown };
      let newTotalPaid = (parseFloat(bill.bll_total_paid) || 0) + paymentAmount;

      if (trn_method === "E-Wallet") {
          const eWallet = await dbClient.collection('wallet').findOne({ wall_owner: trn_user_init });
          if (!eWallet) {
              return res.status(400).json({ message: 'E-Wallet not found.' });
          }
          if (eWallet.wall_bal < paymentAmount) {
              return res.status(400).json({ message: 'Insufficient E-Wallet balance.' });
          }

          await dbClient.collection('wallet').updateOne(
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

      const newPayStat = ((isWaterPaid && isHoaPaid && isGarbagePaid) && parseFloat(newTotalPaid) >= parseFloat(bill.bll_total_amt_due)) ? "paid" : "pending";

      const transaction = {
          trn_id,
          trn_type,
          trn_user_init,
          trn_created_at: new Date(trn_created_at),
          trn_purp,
          trn_method,
          trn_amount: paymentAmount,
          trn_status: 'completed',
          trn_image_url,
          bill_id
      };

      await dbClient.collection('transactions').insertOne(transaction);

      await dbClient.collection('statements').updateOne(
          { bll_id: bill_id },
          {
              $set: {
                  bll_total_paid: newTotalPaid.toFixed(2),
                  bll_pay_stat: newPayStat,
                  bll_paid_breakdown: newPaidBreakdown,
                  transactions_status: newPayStat == "paid" ? "completed" : "pending"
              }
          },
          { upsert: true }
      );

    
      res.status(201).json({
          message: 'Transaction created and billing statement updated successfully.',
          transactionId: trn_id,
      });
  } catch (error) {
      console.error('Error processing transaction:', error);
      res.status(500).json({ message: 'Internal server error.' });
  }
});


// GET /api/users/:usr_id/properties - Fetch properties specific to a user by usr_id
router.get("/users/:usr_id/properties", async (req, res) => {
  const { usr_id } = req.params;

  try {
    const database = getDb();
    const propertiesCollection = database.collection("properties");

    const properties = await propertiesCollection
      .aggregate([
        { $match: { prop_owner_id: usr_id } }, // Match properties with the specific usr_id
        {
          $lookup: {
            from: "users",
            localField: "prop_owner_id",
            foreignField: "usr_id",
            as: "ownerDetails",
          },
        },
        { $unwind: "$ownerDetails" },
        {
          $lookup: {
            from: "wallet",
            localField: "prop_wall_bal",
            foreignField: "_id",
            as: "walletDetails",
          },
        },
        { $unwind: "$walletDetails" },
        {
          $project: {
            _id: 1,
            prop_id: 1,
            prop_type: 1,
            prop_owner: {
              $concat: [
                "$ownerDetails.usr_first_name",
                " ",
                "$ownerDetails.usr_last_name",
              ],
            },
            prop_owner_id: 1,
            prop_lot_num: 1,
            prop_street: 1,
            prop_image_url: 1,
            prop_payment_status: 1,
            prop_billing_status: 1,
            prop_curr_hoamaint_fee: 1,
            prop_curr_water_charges: 1,
            prop_curr_garb_fee: 1,
            prop_tot_adv_water_pay: 1,
            prop_tot_adv_hoa_pay: 1,
            prop_tot_adv_garb_pay: 1,
            prop_curr_amt_due: 1,
            prop_wall_bal: "$walletDetails.wall_bal",
            prop_collectibles_total: 1,
            prop_created_at: 1,
            prop_updated_at: 1,
            prop_owner_hist: 1,
            prop_owner_email: "$ownerDetails.usr_email",
            prop_owner_phone: "$ownerDetails.usr_phone",
          },
        },
      ])
      .toArray();

    if (!properties || properties.length === 0) {
      return res
        .status(404)
        .json({ error: "No properties found for this user" });
    }

    const data = JSON.parse(JSON.stringify(properties));
    // Convert all Decimal128 fields to strings, including nested ones
    const propertiesResponse = data.map(convertDecimal128FieldsToString);
    res.status(200).json(propertiesResponse);
  } catch (err) {
    console.error("Error fetching properties for user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:usr_id/transactions", async (req, res) => {
  const { usr_id } = req.params;

  try {
    const database = getDb();
    const transactionsCollection = database.collection("transactions");

    const transactions = await transactionsCollection
      .aggregate([
        { $match: { trn_user_init: usr_id } }, // Match transactions for this user

        {
          $project: {
            trn_id: 1,
            trn_type: 1,
            trn_user_init: 1, // Links to ObjectId from users collection
            trn_created_at: 1,
            trn_purp: 1,
            trn_purp_id: 1, // Links to ObjectId from billing statements (nullable)
            trn_status: 1,
            trn_status_up: 1, // Links to ObjectId from users collection
            trn_method: 1,
            trn_amount: 1,
            trn_ornum: 1,
            trn_stat_link: 1, // Links to ObjectId from billing statements
            trn_image_url: 1,
          },
        },
      ])
      .toArray();

    if (!transactions || transactions.length === 0) {
      return res
        .status(404)
        .json({ error: "No transactions found for this user" });
    }

    res.status(200).json(transactions);
  } catch (err) {
    console.error("Error fetching transactions for user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----
// PROPERTY FUNCTIONS
// ----

// POST /api/create_property - Create a new property
router.post("/create_property", async (req, res) => {
  const { homeownerID, propertyLot, propertyStreet } = req.body;

  const defHousePic = "https://cdn.cvconnect.app/cvhouse_default.jpg";
  const timestamp = new Date(); // Get the current date and time

  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }

    const propertiesCollection = database.collection("properties");
    const usersCollection = database.collection("users");
    const walletCollection = database.collection("wallet"); // Access the wallet collection

    // Check if homeownerID exists in the users collection by matching usr_id
    const user = await usersCollection.findOne({ usr_id: homeownerID });
    if (!user) {
      return res.status(404).json({ error: "*Homeowner not found" });
    }

    // Retrieve the user's wallet using usr_wallet_id
    const userWallet = await walletCollection.findOne({
      wall_owner: homeownerID,
    });
    if (!userWallet) {
      return res.status(404).json({ error: "*Wallet not found for the user" });
    }

    // Check if the property lot is already occupied
    const existingProperty = await propertiesCollection.findOne({
      prop_lot_num: propertyLot,
    });
    if (existingProperty) {
      return res.status(400).json({ error: "*Lot number is already occupied" });
    }

    // Generate a unique prop_id and ensure it doesn't exist in the database
    let prop_id;
    let propExists;
    do {
      prop_id = "CVP" + Math.random().toString(36).substring(2, 8);
      propExists = await propertiesCollection.findOne({ prop_id: prop_id });
    } while (propExists); // Regenerate until a unique prop_id is found

    // Prepare the prop_collectibles_total object with relevant fees and charges
    const propCollectiblesTotal = {
      prop_tot_water_charge: Decimal128.fromString("0.00"),
      prop_tot_hoamaint_fee: Decimal128.fromString("0.00"),
      prop_tot_garb_fee: Decimal128.fromString("0.00"),
      prop_tot_amt_due: Decimal128.fromString("0.00"),
    };

    // Create the property with the matched user as the prop_owner (store ObjectId)
    await propertiesCollection.insertOne({
      prop_id: prop_id,
      prop_type: "owned",
      prop_owner: user._id, // Link property to the user's ObjectId
      prop_owner_id: user.usr_id,
      prop_owner_lastname: user.usr_last_name,
      prop_lot_num: propertyLot,
      prop_street: propertyStreet,
      prop_image_url: defHousePic,
      prop_payment_status: "PENDING ADMIN CHANGES",
      prop_billing_status: "pending",
      prop_curr_hoamaint_fee: Decimal128.fromString("0.00"),
      prop_curr_water_charges: Decimal128.fromString("0.00"),
      prop_curr_garb_fee: Decimal128.fromString("0.00"),
      prop_tot_adv_water_pay: userWallet.wall_adv_water_pay, // Set to wall_adv_water_pay from wallet
      prop_tot_adv_hoa_pay: userWallet.wall_adv_hoa_pay,
      prop_tot_adv_garb_pay: userWallet.wall_adv_garb_pay,
      prop_curr_amt_due: Decimal128.fromString("0.00"),
      prop_wall_bal: user.usr_wallet_bal, // Use usr_wallet_bal from matched user
      prop_collectibles_total: propCollectiblesTotal, // Add collectible data
      prop_created_at: timestamp,
      prop_updated_at: timestamp,
      prop_owner_hist: [],
    });

    res.status(200).json({ message: "Property created successfully" });
  } catch (err) {
    console.error("Error creating property:", err);
    res.status(500).json({ error: "*Failed to create property" });
  }
});

// GET /api/properties - Fetch all properties
router.get("/properties", async (req, res) => {
  try {
    const database = getDb(); // Get the database instance
    const propertiesCollection = database.collection("properties"); // Access the 'properties' collection

    // Use MongoDB aggregation to join the 'users' collection and get owner's details
    const properties = await propertiesCollection
      .aggregate([
        {
          $lookup: {
            from: "users", // Join with the 'users' collection
            localField: "prop_owner", // Match the prop_owner field in properties
            foreignField: "_id", // Match the _id field in users
            as: "ownerDetails", // Output array with owner details
          },
        },
        {
          $unwind: "$ownerDetails", // Unwind to turn the array into a single object
        },
        {
          $project: {
            prop_id: 1,
            prop_type: 1,
            prop_lot_num: 1,
            prop_street: 1,
            prop_image_url: 1,
            prop_owner: {
              $concat: [
                "$ownerDetails.usr_first_name",
                " ",
                "$ownerDetails.usr_last_name",
              ], // Combine first and last names
            },
            prop_owner_lastname: 1,
            prop_created_at: 1, // Ensure createdAt is included for sorting
          },
        },
        {
          $sort: { prop_created_at: -1 }, // Sort from latest to oldest
        },
      ])
      .toArray();

    res.json(properties); // Send the property data as JSON
  } catch (err) {
    console.error("[SERVER] Error fetching properties:", err);
    res.status(500).json({ error: "Failed to fetch properties" }); // Handle errors
  }
});

router.get("/properties/get_collectible_id", async (req, res) => {
  try {
    const database = getDb();
    if (!database) {
      console.error("Database connection is not initialized");
      return res.status(500).json({ error: "Database not connected" });
    }

    const billingStatementsCollection = database.collection("statements");
    let newId;
    let idExists;

    do {
      // Generate a new collectible ID with 10 random characters
      newId = "CVOB" + Math.random().toString(36).substring(2, 12);
      // Check if this ID already exists in any document's bll_other_coll array
      idExists = await billingStatementsCollection.findOne({
        bll_other_coll: { $elemMatch: { bll_other_coll_id: newId } },
      });
    } while (idExists);

    res.status(200).json({ uniqueId: newId });
  } catch (err) {
    console.error("Error checking collectible ID:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/properties/:prop_id - Fetch a specific property by ID
router.get("/properties/:prop_id", async (req, res) => {
  const { prop_id } = req.params;

  try {
    const database = getDb();
    const propertiesCollection = database.collection("properties");

    const property = await propertiesCollection
      .aggregate([
        { $match: { prop_id: prop_id } },
        {
          $lookup: {
            from: "users",
            localField: "prop_owner",
            foreignField: "_id",
            as: "ownerDetails",
          },
        },
        { $unwind: "$ownerDetails" },
        {
          $lookup: {
            from: "wallet",
            localField: "prop_wall_bal",
            foreignField: "_id",
            as: "walletDetails",
          },
        },
        { $unwind: "$walletDetails" },
        {
          $project: {
            _id: 1,
            prop_id: 1,
            prop_type: 1,
            prop_owner: {
              $concat: [
                "$ownerDetails.usr_first_name",
                " ",
                "$ownerDetails.usr_last_name",
              ],
            },
            prop_owner_id: 1,
            prop_owner_lastname: 1,
            prop_lot_num: 1,
            prop_street: 1,
            prop_image_url: 1,
            prop_payment_status: 1,
            prop_billing_status: 1,
            prop_curr_hoamaint_fee: 1,
            prop_curr_water_charges: 1,
            prop_curr_garb_fee: 1,
            prop_tot_adv_water_pay: 1,
            prop_tot_adv_hoa_pay: 1,
            prop_tot_adv_garb_pay: 1,
            prop_curr_amt_due: 1,
            prop_wall_bal: "$walletDetails.wall_bal",
            prop_collectibles_total: 1,
            prop_created_at: 1,
            prop_updated_at: 1,
            prop_owner_hist: 1,
            prop_owner_email: "$ownerDetails.usr_email",
            prop_owner_phone: "$ownerDetails.usr_phone",
          },
        },
      ])
      .toArray();

    if (!property || property.length === 0) {
      return res.status(404).json({ error: "Property not found" });
    }

    const data = JSON.parse(JSON.stringify(property[0]));
    // Convert all Decimal128 fields to strings, including nested ones
    const propertyResponse = convertDecimal128FieldsToString(data);
    res.status(200).json(propertyResponse);
  } catch (err) {
    console.error("Error fetching property:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/properties/:prop_id/new_billing_statement", async (req, res) => {
  const { prop_id } = req.params;
  const {
    waterConsump,
    waterCharges,
    waterRead,
    garbCharges,
    hoaFee,
    billCovPeriod,
    bll_water_cons_img,
    otherColl,
    totalBill,
    imageUrl
  } = req.body;

  const timestamp = new Date(); // Get the current date and time

  try {
    const database = getDb();
    const propertiesCollection = database.collection("properties");
    const billingStatementsCollection = database.collection("statements");

    // Check if the property exists
    const property = await propertiesCollection.findOne({ prop_id });
    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    // Generate a unique bll_id
    let bll_id;
    let bllExists;
    do {
      bll_id = "CVB" + Math.random().toString(36).substring(2, 12);
      bllExists = await billingStatementsCollection.findOne({ bll_id });
    } while (bllExists);

    // Ensure otherColl is an array and format it
    const formattedOtherColl = (otherColl || []).map((item) => ({
      ...item,
    }));

    // Convert `billCovPeriod` to a sortable format (e.g., 2024-01)
    const [month, year] = billCovPeriod.split(" ");
    const monthMapping = {
      january: "01",
      february: "02",
      march: "03",
      april: "04",
      may: "05",
      june: "06",
      july: "07",
      august: "08",
      september: "09",
      october: "10",
      november: "11",
      december: "12",
    };
    const sortableBillPeriod = `${year}-${monthMapping[month.toLowerCase()]}`; // Format as YYYY-MM
    const parsedBillPeriodDate = new Date(`${sortableBillPeriod}-01T00:00:00Z`); // Parse as a Date

    // Safely parse values and use defaults for undefined fields
    const newBillingStatement = {
      bll_id,
      bll_pay_stat: "pending",
      bll_init: req.user?.role || "unknown", // Fallback if req.user is undefined
      bll_user_init: req.user?.usr_id || "unknown",
      bll_water_consump: parseFloat(waterConsump || 0),
      bll_water_charges: Decimal128.fromString(
        (waterCharges || "0.00").toString()
      ),
      bll_water_read: parseFloat(waterRead || 0),
      bll_water_cons_img: imageUrl || null,
      bll_garb_charges: Decimal128.fromString(
        (garbCharges || "0.00").toString()
      ),
      bll_hoamaint_fee: Decimal128.fromString((hoaFee || "0.00").toString()),
      bll_prop_id: property.prop_id,
      bll_user_rec: property.prop_owner,
      bll_bill_cov_period: sortableBillPeriod, // Store the sortable format
      bll_bill_cov_period_date: parsedBillPeriodDate, // Store as a Date for further sorting
      bll_created_at: timestamp,
      bll_updated_at: timestamp,
      bll_other_coll: formattedOtherColl,
      bll_total_paid: Decimal128.fromString("0.00"),
      bll_total_amt_due: Decimal128.fromString((totalBill || 0).toFixed(2)),
      transactions_status:"pending",
    };

    // Insert the new billing statement into the database
    await billingStatementsCollection.insertOne(newBillingStatement);

    res.status(200).json({ message: "Billing statement created successfully" });
  } catch (err) {
    console.error("Error creating billing statement:", err);
    res.status(500).json({ error: "Failed to create billing statement" });
  }
});

router.get("/properties/:prop_id/statements", async (req, res) => {
  const { prop_id } = req.params;

  try {
    const database = getDb(); // Get the database instance
    const billingStatementsCollection = database.collection("statements"); // Access the 'statements' collection

    // Query all statements for the given property ID
    const statements = await billingStatementsCollection
    .find({ bll_prop_id: prop_id }) // Filter by the specific property ID
    .sort({ bll_bill_cov_period_date: -1 }) // Sort by creation date in descending order
    .toArray(); // Convert to an array
    
    const data = convertDecimal128FieldsToString(JSON.parse(JSON.stringify(statements)))
    // Return an empty array if no billing statements are found
    res.status(200).json(data || []);
  } catch (err) {
    console.error("Error fetching billing statements:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/properties/:prop_id/statement_total
router.get("/properties/:prop_id/statement_total", async (req, res) => {
  const { prop_id } = req.params;

  try {
    const database = getDb(); // Get the database instance
    const billingStatementsCollection = database.collection("statements"); // Access the 'statements' collection

    // Aggregate to sum up all bll_total_amt_due for partial or pending statements of the given property
    const result = await billingStatementsCollection
      .aggregate([
        {
          $match: {
            bll_prop_id: prop_id, // Match the specific property ID
            bll_pay_stat: { $in: ["partial", "pending"] }, // Match partial or pending payment statuses
          },
        },
        {
          $group: {
            _id: null, // Group all matching documents together
            totalDue: { $sum: "$bll_total_amt_due" }, // Sum up the bll_total_amt_due field
          },
        },
      ])
      .toArray();

    // Extract the totalDue or default to 0 if no matching statements are found
    const totalDueDecimal = result.length > 0 ? result[0].totalDue : 0;

    // Ensure the totalDueDecimal is converted to a proper number or string
    const totalDue =
      totalDueDecimal._bsontype === "Decimal128"
        ? parseFloat(totalDueDecimal.toString()) // Convert Decimal128 to a plain number
        : totalDueDecimal;

    res.status(200).json({ totalDue }); // Send the totalDue as a number
  } catch (err) {
    console.error("Error calculating total due:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/properties/:prop_id/latest_statement_water_consump
router.get(
  "/properties/:prop_id/latest_statement_water_consump",
  async (req, res) => {
    const { prop_id } = req.params;

    try {
      const database = getDb(); // Get the database instance
      const billingStatementsCollection = database.collection("statements"); // Access the 'statements' collection

      // Query the latest statement for the given property ID based on bll_bill_cov_period_date
      const latestStatement = await billingStatementsCollection
        .find({ bll_prop_id: prop_id }) // Filter by the specific property ID
        .sort({ bll_bill_cov_period_date: -1 }) // Sort by coverage period date in descending order
        .limit(1) // Get the most recent document
        .toArray();

      // Check if a statement exists
      if (!latestStatement || latestStatement.length === 0) {
        return res.status(200).json({ bll_water_consump: 0 }); // Return "0" if no statement is found
      }

      const data = JSON.parse(JSON.stringify(latestStatement[0]));
      // Extract the statement and apply the helper function
      const convertedStatement = convertDecimal128FieldsToString(data);

      res
        .status(200)
        .json({ bll_water_consump: convertedStatement.bll_water_consump });
    } catch (err) {
      console.error("Error fetching latest water consumption:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/properties/:prop_id/latest_statement", async (req, res) => {});

router.post("/properties/:prop_id/edit-property", async (req, res) => {});

// ----
// TRANSACTION FUNCTIONS
// ----

// GET /api/transactions - Fetch transactions with detailed information
router.get("/transactions", async (req, res) => {
  try {
    const database = getDb();
    const transactionsCollection = database.collection("transactions"); // Access the 'transactions' collection

    // Use aggregation to join with users and statements collections
    const transactions = await transactionsCollection
      .aggregate([
        {
          $lookup: {
            from: "users",
            localField: "trn_user_init",
            foreignField: "usr_id",
            as: "initiatorDetails",
          },
        },
        {
          $unwind: {
            path: "$initiatorDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "trn_status_up",
            foreignField: "usr_id",
            as: "statusUpdaterDetails",
          },
        },
        {
          $unwind: {
            path: "$statusUpdaterDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $lookup: {
            from: "statements",
            localField: "trn_purp_id",
            foreignField: "bll_id",
            as: "statementDetails",
          },
        },
        {
          $unwind: {
            path: "$statementDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            trn_id: 1,
            trn_type: 1,
            trn_user_init: {
              $concat: [
                { $ifNull: ["$initiatorDetails.usr_first_name", ""] },
                " ",
                { $ifNull: ["$initiatorDetails.usr_last_name", ""] },
              ],
            },
            initiatorDetails: 1, // Include raw initiator details for debugging
            trn_created_at: 1,
            trn_purp: 1,
            trn_purp_id: "$statementDetails.bll_id",
            trn_status: 1,
            trn_reason: 1,
            statusUpdaterDetails: 1, // Include raw status updater details for debugging
            trn_method: 1,
            trn_amount: 1,
            trn_ornum: 1,
            trn_stat_link: "$statementDetails.bll_id",
            trn_image_url: 1,
          },
        },
      ])
      .toArray();

    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ error: "No transactions found" });
    }
    const data = JSON.parse(JSON.stringify(transactions));
    // Convert all Decimal128 fields to strings, including nested ones
    const transactionsResponse = data.map(convertDecimal128FieldsToString);
    res.status(200).json(transactionsResponse);
  } catch (err) {
    console.error("[SERVER] Error fetching transactions:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

router.get("/transactions/:trn_id", async (req, res) => {});

router.post("/transactions/:trn_id/approve", async (req, res) => {});

router.post("/transactions/:trn_id/reject", async (req, res) => {});

// ----
// WALLET FUNCTIONS
// ----

router.get("/wallet", async (req, res) => {
  try {
    const database = getDb(); // Get the database instance
    const walletCollection = database.collection("villwallet"); // Access the 'wallet' collection
    const userCollection = database.collection("users"); // Access the 'wallet' collection
    const wallet = await walletCollection.find({}).toArray(); // Fetch all wallet from the collection

    const data = JSON.parse(JSON.stringify(wallet[0]));
    // Convert all Decimal128 fields to strings, including nested ones
    const walletResponse = convertDecimal128FieldsToString(data);
    console.log(walletResponse)
    // const user = await userCollection.findOne({usr_id: walletResponse}); // Fetch all wallet from the collection

    res.status(200).json(walletResponse);
  } catch (err) {
    console.error("[SERVER] Error fetching data:", err);
    res.status(500).json({ error: "Failed to fetch data" }); // Handle errors
  }
});

router.get("/wallet/:villwall_trn_id", async (req, res) => {});

// POST /wallet/spend
router.post("/wallet/spend", async (req, res) => {
  const { _id, amount, description, userId } = req.body; // Ensure _id is included in the request
  const vw_id = "CVVW000001";

  try {
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: "Amount must be a numeric value" });
    }

    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }
    const database = getDb();
    const walletCollection = database.collection("villwallet");

    // Find the wallet
    const wallet = await walletCollection.findOne({ villwall_id: vw_id });
    if (!wallet) {
      console.error(`Wallet not found: ${vw_id}`);
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Ensure sufficient balance
    if (wallet.villwall_tot_bal < parseFloat(amount)) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Generate a unique transaction ID
    let transactionID;
    let transactionExists;
    do {
      transactionID = "CVVWT" + Math.random().toString(36).substring(2, 12);
      transactionExists = wallet?.villwall_trn_hist?.some(
        (trn) => trn.villwall_trn_id === transactionID
      );
    } while (transactionExists);

    // Create a new transaction
    const transaction = {
      villwall_trn_id: transactionID,
      villwall_trn_type: "expense",
      villwall_trn_created_at: new Date(),
      villwall_trn_amt: parseFloat(amount), // Ensure amount is a float
      villwall_trn_link: userId || "admin",
      villwall_trn_description: description
    };

    // Update the wallet
    const updatedWallet = await walletCollection.updateOne(
      { villwall_id: vw_id },
      {
        $inc: { villwall_tot_bal: -parseFloat(amount) }, // Deduct amount
        $push: { villwall_trn_hist: transaction }, // Add transaction to history
      }
    );

    if (!updatedWallet.modifiedCount) {
      console.error(`Failed to update wallet: ${vw_id}`);
      return res.status(500).json({ error: "Failed to update wallet" });
    }

    res.status(200).json({ message: "Transaction successful", transaction });
  } catch (err) {
    console.error("Error processing spend transaction:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /wallet/deposit
router.post("/wallet/deposit", async (req, res) => {
  const { _id, amount, description, userId } = req.body;
  const vw_id = "CVVW000001";

  try {
    if (!amount || isNaN(amount)) {
      return res.status(400).json({ error: "Amount must be a numeric value" });
    }

    if (!description) {
      return res.status(400).json({ error: "Description is required" });
    }


    const database = getDb();
    const walletCollection = database.collection("villwallet");

    // Find the wallet
    const wallet = await walletCollection.findOne({ villwall_id: vw_id });
    if (!wallet) {
      console.error(`Wallet not found: ${vw_id}`);
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Generate a unique transaction ID
    let transactionID;
    let transactionExists;
    do {
      transactionID = "CVVWT" + Math.random().toString(36).substring(2, 12);
      transactionExists = wallet?.villwall_trn_hist?.some(
        (trn) => trn.villwall_trn_id === transactionID
      );
    } while (transactionExists);

    // Create a new transaction
    const transaction = {
      villwall_trn_id: transactionID,
      villwall_trn_type: "collect",
      villwall_trn_created_at: new Date(),
      villwall_trn_amt: parseFloat(amount), // Ensure amount is a float
      villwall_trn_link: userId || "admin",
      villwall_trn_description: description
    };

    // Update the wallet
    const updatedWallet = await walletCollection.updateOne(
      { villwall_id: vw_id },
      {
        $inc: { villwall_tot_bal: parseFloat(amount) }, // Ensure increment works
        $push: { villwall_trn_hist: transaction },
      }
    );

    if (!updatedWallet.modifiedCount) {
      console.error(`Failed to update wallet: ${vw_id}`);
      return res.status(500).json({ error: "Failed to update wallet" });
    }

    res.status(200).json({ message: "Transaction successful", transaction });
  } catch (err) {
    console.error("Error processing deposit transaction:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----
// SETTINGS FUNCTIONS
// ----

// GET /settings/misc - get all data from the misc collection
router.get("/settings/misc", async (req, res) => {
  try {
    const database = getDb();
    const settingsCollection = database.collection("misc");
    const data = await settingsCollection.find({}).toArray();

    // Convert Decimal128 fields to strings
    const convertedData = convertDecimal128FieldsToString(
      JSON.parse(JSON.stringify(data))
    );
    res.status(200).json(convertedData);
  } catch (err) {
    console.error("[SERVER] Error fetching misc:", err);
    res.status(500).json({ error: "Failed to fetch misc" }); // Handle errors
  }
});

// GET /api/settings/misc/hoa_rate - Fetch the HOA rate from the misc collection
router.get("/settings/misc/hoa_rate", async (req, res) => {
  try {
    const database = getDb(); // Get the database instance
    const settingsCollection = database.collection("misc"); // Access the 'misc' collection

    // Find the document with misc_type equal to 'hoa_rate'
    const hoaRate = await settingsCollection.findOne({ misc_type: "hoa_rate" });

    if (!hoaRate) {
      return res.status(404).json({ error: "HOA rate not found" });
    }

    const data = JSON.parse(JSON.stringify(hoaRate));
    // Convert any Decimal128 fields to strings if needed
    const hoaRateResponse = convertDecimal128FieldsToString(data);
    res.status(200).json(hoaRateResponse);
  } catch (err) {
    console.error("Error fetching HOA rate:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/settings/misc/water_rate - Fetch all water rate documents from the misc collection
router.get("/settings/misc/water_rate", async (req, res) => {
  try {
    const database = getDb(); // Get the database instance
    const settingsCollection = database.collection("misc"); // Access the 'misc' collection

    // Find all documents with misc_type equal to 'water_rate'
    const waterRates = await settingsCollection
      .find({ misc_type: "water_rate" })
      .toArray();

    if (!waterRates || waterRates.length === 0) {
      return res.status(404).json({ error: "No water rates found" });
    }

    const data = JSON.parse(JSON.stringify(waterRates));
    // Convert any Decimal128 fields to strings if needed
    const waterRatesResponse = data.map(convertDecimal128FieldsToString);
    res.status(200).json(waterRatesResponse);
  } catch (err) {
    console.error("Error fetching water rates:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/settings/misc/garb_rate - Fetch all garbage rate documents from the misc collection
router.get("/settings/misc/garb_rate", async (req, res) => {
  try {
    const database = getDb(); // Get the database instance
    const settingsCollection = database.collection("misc"); // Access the 'misc' collection

    // Find the document with misc_type equal to 'hoa_rate'
    const hoaRate = await settingsCollection.findOne({
      misc_type: "garb_rate",
    });

    if (!hoaRate) {
      return res.status(404).json({ error: "Garbage rate not found" });
    }

    const data = JSON.parse(JSON.stringify(hoaRate));
    // Convert any Decimal128 fields to strings if needed
    const hoaRateResponse = convertDecimal128FieldsToString(data);
    res.status(200).json(hoaRateResponse);
  } catch (err) {
    console.error("Error fetching garbage rate:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/settings/new-rate", async (req, res) => {
  const {
    miscAnnRate,
    miscAnnUnit,
    miscUnit,
    calculatedMiscUnitAmt,
    miscRangeMin,
    miscRangeMax,
    miscDesc,
    miscType,
  } = req.body;

  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }

    const timestamp = new Date(); // Get the current date and time

    const settingsCollection = database.collection("misc");

    // Insert the new rate document
    await settingsCollection.insertOne({
      misc_type: miscType,
      misc_ann_rate: Decimal128.fromString(miscAnnRate),
      misc_ann_unit: miscAnnUnit,
      misc_unit: miscUnit,
      misc_unit_amt: Decimal128.fromString(calculatedMiscUnitAmt),
      misc_unit_range_min: miscRangeMin,
      misc_unit_range_max: miscRangeMax,
      misc_desc: miscDesc,
      created_at: timestamp,
      updated_at: timestamp,
    });

    res.status(200).json({ message: "New rate added successfully" });
  } catch (err) {
    console.error("Error adding a new rate:", err);
    res.status(500).json({ error: "*Failed to add a new rate" });
  }
});

router.post("/settings/new-water-rate", async (req, res) => {
  const {
    miscAnnRate,
    miscAnnUnit,
    miscUnit,
    calculatedMiscUnitAmt,
    miscRangeMin,
    miscRangeMax,
    miscDesc,
    miscType,
  } = req.body;
  let computedMiscUnitAmt = 0;
  let computedMiscAnnRate = 0;

  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }

    const timestamp = new Date(); // Get the current date and time

    const settingsCollection = database.collection("misc");

    if (miscRangeMin >= 0 && miscRangeMax <= 10 && miscAnnRate == 33) {
      computedMiscUnitAmt = 330;
      computedMiscAnnRate = 330;
    } else if (miscRangeMin >= 11 && miscRangeMax <= 20) {
      computedMiscAnnRate = miscAnnRate * 10;
      computedMiscUnitAmt = miscAnnRate;
    } else if (miscRangeMin >= 21 && miscRangeMax <= 30) {
      computedMiscAnnRate = miscAnnRate * 10;
      computedMiscUnitAmt = miscAnnRate;
    } else if (miscRangeMin >= 31 && miscRangeMax <= 40) {
      computedMiscAnnRate = miscAnnRate * 10;
      computedMiscUnitAmt = miscAnnRate;
    } else if (miscRangeMin >= 41 && miscRangeMax <= 100) {
      computedMiscAnnRate = miscAnnRate * 10;
      computedMiscUnitAmt = miscAnnRate;
    } else {
      throw new Error("Water Rate Error");
    }

    // Insert the new rate document
    await settingsCollection.insertOne({
      misc_type: miscType,
      misc_ann_rate: Decimal128.fromString(computedMiscAnnRate.toString()),
      misc_ann_unit: miscAnnUnit,
      misc_unit: miscUnit,
      misc_unit_amt: Decimal128.fromString(computedMiscUnitAmt.toString()),
      misc_unit_range_min: miscRangeMin,
      misc_unit_range_max: miscRangeMax,
      misc_desc: miscDesc,
      created_at: timestamp,
      updated_at: timestamp,
    });

    res.status(200).json({ message: "New rate added successfully" });
  } catch (err) {
    console.error("Error adding a new rate:", err);
    res.status(500).json({ error: "*Failed to add a new rate" });
  }
});

router.post("/settings/delete-rate", async (req, res) => {
  const { id } = req.body;

  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }

    const settingsCollection = database.collection("misc");

    // Delete the document with the given id
    const result = await settingsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ error: "Rate not found or already deleted" });
    }

    res.status(200).json({ message: "Rate deleted successfully" });
  } catch (err) {
    console.error("Error deleting rate:", err);
    res.status(500).json({ error: "Failed to delete rate" });
  }
});

//-----------------------------------------------Dashboard endpoint------------------------------------------

router.get("/dashboard", async (req, res) => {
  try {
    const database = getDb();
    if (!database) {
      throw new Error("Database connection failed.");
    }

    const transactionsCollection = database.collection("transactions");

    // Get the first and last day of the current month
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59
    );

    // Fetch transactions only for the current month using 'trn_created_at'
    const transactions = await transactionsCollection
      .find({ trn_created_at: { $gte: firstDay, $lte: lastDay } })
      .toArray();

    // Calculate totals
    const totalCollection = transactions.reduce(
      (acc, transaction) => {
        if (transaction.trn_status === "pending") {
          acc.pending += transaction.trn_amount || 0;
        } else if (transaction.trn_status === "completed") {
          acc.completed += transaction.trn_amount || 0;
        }
        return acc;
      },
      { completed: 0, pending: 0 }
    );

    res.status(200).json(totalCollection);
  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

export default router;
