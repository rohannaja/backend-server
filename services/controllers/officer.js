// services/db/userRoutes.js

import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import tinify from 'tinify';
import { ObjectId, Decimal128 } from 'mongodb';
import {getDb} from '../db/db.js';
import 'dotenv/config'; // Load environment variables

const router = express.Router();
// Import sendWelcomeEmail from emailService

tinify.key = process.env.TINIFY_API_KEY;

// ----
// HELPER FUNCTIONS
// ----

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
  


// ----
// LOGIN FUCNTIONS
// ----

// POST /api/login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
  
    try {
      const database = getDb();
      const usersCollection = database.collection('users');
  
      // Find the user by username
      const user = await usersCollection.findOne({ usr_username: username });
  
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
  
      // Compare the provided password with the hashed password stored in the database
      const isPasswordValid = await bcrypt.compare(password, user.usr_password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
  
      // If valid, return the user object with relevant fields
      res.status(200).json({
        _id: user._id,
        usr_id: user.usr_id, // Custom user ID (e.g., 'CVU******')
        usr_username: user.usr_username,
        usr_email: user.usr_email,
        usr_role: user.usr_role,
        usr_profile_photo: user.usr_profile_photo
      });
    } catch (err) {
      console.error('Error logging in:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
});



// ----
// USER FUCNTIONS
// ----

// GET /api/users - Fetch all users
router.get('/users', async (req, res) => {
    try {
      const database = getDb(); // Get the database instance
      const usersCollection = database.collection('users'); // Access the 'users' collection
      const users = await usersCollection.find({}).toArray(); // Fetch all users from the collection
      res.json(users); // Send the user data as JSON
    } catch (err) {
      console.error('[SERVER] Error fetching users:', err);
      res.status(500).json({ error: 'Failed to fetch users' }); // Handle errors
    }
  });
  
  
  
  // GET /api/users/:usr_id - Fetch a specific user by ID
  router.get('/users/:usr_id', async (req, res) => {
    const { usr_id } = req.params;  // Extract the usr_id from the URL
  
    try {
      const database = getDb();  // Get the database instance
      const usersCollection = database.collection('users');  // Access the 'users' collection
  
      // Use MongoDB aggregation to join the 'wallet' collection and retrieve the wallet balance
      const user = await usersCollection.aggregate([
        { $match: { usr_id: usr_id } },  // Match the user by usr_id
        {
          $lookup: {
            from: 'wallet',                 // Join with the 'wallet' collection
            localField: 'usr_wallet_bal',   // Use the usr_wallet_bal (ObjectId) from users
            foreignField: '_id',            // Match with _id in wallet collection
            as: 'walletDetails'             // Output array with wallet details
          }
        },
        { $unwind: '$walletDetails' },      // Unwind to access wallet fields directly
        {
          $project: {                       // Project the fields to return in the final output
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
            usr_wallet_bal: '$walletDetails.wall_bal',  // Retrieve wall_bal from wallet
            // Add other fields you need here
          }
        }
      ]).toArray();
  
      if (!user || user.length === 0) {
        return res.status(404).json({ error: 'User not found' });  // Handle case where user is not found
      }
      const data = JSON.parse(JSON.stringify(user[0]))
      // Convert all Decimal128 fields to strings, including nested ones
      const userResponse = convertDecimal128FieldsToString(data);
      res.status(200).json(userResponse);
    } catch (err) {
      console.error('Error fetching user:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  
  
  // POST /api/create-account - Create user account with wallet
  router.post('/create_account', async (req, res) => {  
    const { first_name, last_name, age, date_of_birth, phone, email, role, username, password } = req.body;
  
    const defProfPic = "https://cdn.cvconnect.app/cvprofile_default.jpg";
    const timestamp = new Date();  // Get the current date and time
  
    try {
      const hashedPassword = await bcrypt.hash(password, 16); // Hash the password
  
      // Check if the database connection is working
      const database = getDb();
      if (!database) {
        throw new Error("Database connection failed.");
      }
  
      const usersCollection = database.collection('users');
      const walletCollection = database.collection('wallet'); // Access the wallet collection
  
      // Check if username already exists in the users collection
      const existingUser = await usersCollection.findOne({ usr_username: username });
      if (existingUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }
  
      // Generate a unique usr_id and ensure it doesn't exist in the database
      let user_id;
      let userExists;
      do {
        user_id = "CVU" + Math.random().toString(36).substring(2, 8);
        userExists = await usersCollection.findOne({ usr_id: user_id });
      } while (userExists);  // Regenerate until a unique usr_id is found
  
      // Generate a unique wall_id and ensure it doesn't exist in the wallet collection
      let wall_id;
      let walletExists;
      do {
        wall_id = "CVW" + Math.random().toString(36).substring(2, 8);
        walletExists = await walletCollection.findOne({ wall_id: wall_id });
      } while (walletExists);  // Regenerate until a unique wall_id is found
  
      // Generate a 6-digit OTP for first login verification
      const generatedOtp = generateOtp();
  
      // Create the wallet for the user
      const walletResult = await walletCollection.insertOne({
        wall_id: wall_id,
        wall_owner: user_id,  // Link to the user's ID
        wall_bal: Decimal128.fromString("0.00"),
        wall_adv_water_pay: Decimal128.fromString("0.00"),
        wall_adv_hoa_pay: Decimal128.fromString("0.00"),
        wall_adv_garb_pay: Decimal128.fromString("0.00"),
        wall_created_at: timestamp,
        wall_updated_at: timestamp
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
        usr_updated_at: timestamp
      });
  
      // Send the welcome email to the new user's email address
      await sendWelcomeEmail(email, generatedOtp, first_name, last_name, username, password);
  
      res.status(200).json({ message: 'Account created successfully' });
    } catch (err) {
      console.error('Error creating account:', err);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });
  
  
  
  router.post('/users/:usr_id/edit-avatar', async (req, res) => {
    // Image upload to follow
  })
  
  
  
  router.post('/users/:usr_id/edit-profile', async (req, res) => {
    
  })
  
  // GET /api/users/:usr_id/properties - Fetch properties specific to a user by usr_id
  router.get('/users/:usr_id/properties', async (req, res) => {
    const { usr_id } = req.params;
  
    try {
      const database = getDb();
      const propertiesCollection = database.collection('properties');
  
      const properties = await propertiesCollection.aggregate([
        { $match: { prop_owner_id: usr_id } }, // Match properties with the specific usr_id
        {
          $lookup: {
            from: 'users',
            localField: 'prop_owner_id',
            foreignField: 'usr_id',
            as: 'ownerDetails'
          }
        },
        { $unwind: '$ownerDetails' },
        {
          $lookup: {
            from: 'wallet',
            localField: 'prop_wall_bal',
            foreignField: '_id',
            as: 'walletDetails'
          }
        },
        { $unwind: '$walletDetails' },
        {
          $project: {
            _id: 1,
            prop_id: 1,
            prop_type: 1,
            prop_owner: {
              $concat: ['$ownerDetails.usr_first_name', ' ', '$ownerDetails.usr_last_name']
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
            prop_wall_bal: '$walletDetails.wall_bal',
            prop_collectibles_total: 1,
            prop_created_at: 1,
            prop_updated_at: 1,
            prop_owner_hist: 1,
            prop_owner_email: '$ownerDetails.usr_email',
            prop_owner_phone: '$ownerDetails.usr_phone',
          }
        }
      ]).toArray();
  
      if (!properties || properties.length === 0) {
        return res.status(404).json({ error: 'No properties found for this user' });
      }
      
      const data = JSON.parse(JSON.stringify(properties))
      // Convert all Decimal128 fields to strings, including nested ones
      const propertiesResponse = data.map(convertDecimal128FieldsToString);
      res.status(200).json(propertiesResponse);
  
    } catch (err) {
      console.error('Error fetching properties for user:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  
  
  
  router.get('/users/:usr_id/transactions', async (req, res) => {
    const { usr_id } = req.params;
  
    try {
      const database = getDb();
      const transactionsCollection = database.collection('transactions');
  
      const transactions = await transactionsCollection.aggregate([
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
            trn_image_url: 1
          }
        }
      ]).toArray();
  
      if (!transactions || transactions.length === 0) {
        return res.status(404).json({ error: 'No transactions found for this user' });
      }
  
      res.status(200).json(transactions);
    } catch (err) {
      console.error('Error fetching transactions for user:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  })

  

// ----
// PROPERTY FUNCTIONS
// ----

// GET /api/properties - Fetch all properties
router.get('/properties', async (req, res) => {
    try {
      const database = getDb(); // Get the database instance
      const propertiesCollection = database.collection('properties'); // Access the 'properties' collection
      // Use MongoDB aggregation to join the 'users' collection and get owner's details
      const properties = await propertiesCollection.aggregate([
        {
          $lookup: {
            from: 'users', // Join with the 'users' collection
            localField: 'prop_owner', // Match the prop_owner field in properties
            foreignField: '_id', // Match the _id field in users
            as: 'ownerDetails' // Output array with owner details
          }
        },
        {
          $unwind: '$ownerDetails' // Unwind to turn the array into a single object
        },
        {
          $project: {
            prop_id: 1,
            prop_type: 1,
            prop_lot_num: 1,
            prop_street: 1,
            prop_image_url: 1,
            prop_owner: {
              $concat: ['$ownerDetails.usr_first_name', ' ', '$ownerDetails.usr_last_name'] // Combine first and last names
            },
            prop_owner_lastname: 1
          }
        }
      ]).toArray();
  
      res.json(properties); // Send the property data as JSON
    } catch (err) {
      console.error('[SERVER] Error fetching properties:', err);
      res.status(500).json({ error: 'Failed to fetch properties' }); // Handle errors
    }
});



router.get('/properties/get_collectible_id', async (req, res) => {
    try {
      const database = getDb();
      if (!database) {
        console.error('Database connection is not initialized');
        return res.status(500).json({ error: 'Database not connected' });
      }
  
      const billingStatementsCollection = database.collection('statements');
      let newId;
      let idExists;
  
      do {
        // Generate a new collectible ID with 10 random characters
        newId = "CVOB" + Math.random().toString(36).substring(2, 12);
        // Check if this ID already exists in any document's bll_other_coll array
        idExists = await billingStatementsCollection.findOne({
          bll_other_coll: { $elemMatch: { bll_other_coll_id: newId } }
        });
      } while (idExists);
  
      res.status(200).json({ uniqueId: newId });
    } catch (err) {
      console.error('Error checking collectible ID:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
});
  
  
  
  // GET /api/properties/:prop_id - Fetch a specific property by ID
router.get('/properties/:prop_id', async (req, res) => {
    const { prop_id } = req.params;
  
    try {
      const database = getDb();
      const propertiesCollection = database.collection('properties');
  
      const property = await propertiesCollection.aggregate([
        { $match: { prop_id: prop_id } },
        {
          $lookup: {
            from: 'users',
            localField: 'prop_owner',
            foreignField: '_id',
            as: 'ownerDetails'
          }
        },
        { $unwind: '$ownerDetails' },
        {
          $lookup: {
            from: 'wallet',
            localField: 'prop_wall_bal',
            foreignField: '_id',
            as: 'walletDetails'
          }
        },
        { $unwind: '$walletDetails' },
        {
          $project: {
            _id: 1,
            prop_id: 1,
            prop_type: 1,
            prop_owner: {
              $concat: ['$ownerDetails.usr_first_name', ' ', '$ownerDetails.usr_last_name']
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
            prop_wall_bal: '$walletDetails.wall_bal',
            prop_collectibles_total: 1,
            prop_created_at: 1,
            prop_updated_at: 1,
            prop_owner_hist: 1,
            prop_owner_email: '$ownerDetails.usr_email',
            prop_owner_phone: '$ownerDetails.usr_phone',
          }
        }
      ]).toArray();
  
      if (!property || property.length === 0) {
        return res.status(404).json({ error: 'Property not found' });
      }
      
      const data = JSON.parse(JSON.stringify(property[0]))
      // Convert all Decimal128 fields to strings, including nested ones
      const propertyResponse = convertDecimal128FieldsToString(data);
      res.status(200).json(propertyResponse);
  
    } catch (err) {
      console.error('Error fetching property:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
});
  
  
  
router.post('/properties/:prop_id/new_billing_statement', async (req, res) => {
    const { prop_id } = req.params;
    const { waterConsump, waterCharges, waterRead, garbCharges, hoaFee, billCovPeriod, bll_water_cons_img, otherColl, totalBill } = req.body;
  
    const timestamp = new Date(); // Get the current date and time
  
    try {
      const database = getDb();
      const propertiesCollection = database.collection('properties');
      const billingStatementsCollection = database.collection('statements');
  
      // Check if the property exists
      const property = await propertiesCollection.findOne({ prop_id });
      if (!property) {
        return res.status(404).json({ error: 'Property not found' });
      }
  
      // Generate a unique bll_id
      let bll_id;
      let bllExists;
      do {
        bll_id = "CVB" + Math.random().toString(36).substring(2, 12);
        bllExists = await billingStatementsCollection.findOne({ bll_id });
      } while (bllExists);
  
      // Ensure otherColl is an array and format it
      const formattedOtherColl = (otherColl || []).map(item => ({
        ...item,
      }));
  
      // Convert `billCovPeriod` to a sortable format (e.g., 2024-01)
      const [month, year] = billCovPeriod.split(" ");
      const monthMapping = {
        January: "01",
        February: "02",
        March: "03",
        April: "04",
        May: "05",
        June: "06",
        July: "07",
        August: "08",
        September: "09",
        October: "10",
        November: "11",
        December: "12",
      };
      const sortableBillPeriod = `${year}-${monthMapping[month]}`; // Format as YYYY-MM
      const parsedBillPeriodDate = new Date(`${sortableBillPeriod}-01T00:00:00Z`); // Parse as a Date
  
      // Compress and upload the image
      let imageUrl = null;
      if (bll_water_cons_img) {
        imageUrl = await compressAndUploadBillImage(bll_water_cons_img, bll_id, timestamp);
      }
  
      // Safely parse values and use defaults for undefined fields
      const newBillingStatement = {
        bll_id,
        bll_pay_stat: "pending",
        bll_init: req.user?.role || "unknown", // Fallback if req.user is undefined
        bll_user_init: req.user?.usr_id || "unknown",
        bll_water_consump: parseFloat(waterConsump || 0),
        bll_water_charges: Decimal128.fromString((waterCharges || "0.00").toString()),
        bll_water_read: parseFloat(waterRead || 0),
        bll_water_cons_img: imageUrl || null,
        bll_garb_charges: Decimal128.fromString((garbCharges || "0.00").toString()),
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
      };
  
      // Insert the new billing statement into the database
      await billingStatementsCollection.insertOne(newBillingStatement);
  
      res.status(200).json({ message: 'Billing statement created successfully' });
    } catch (err) {
      console.error('Error creating billing statement:', err);
      res.status(500).json({ error: 'Failed to create billing statement' });
    }
});
  
  
  
router.get('/properties/:prop_id/statements', async (req, res) => {
    const { prop_id } = req.params;
  
      try {
          const database = getDb(); // Get the database instance
          const billingStatementsCollection = database.collection('statements'); // Access the 'statements' collection
  
          // Query all statements for the given property ID
          const statements = await billingStatementsCollection
              .find({ bll_prop_id: prop_id }) // Filter by the specific property ID
              .sort({ bll_bill_cov_period_date: -1 }) // Sort by creation date in descending order
              .toArray(); // Convert to an array
  
          // Return an empty array if no billing statements are found
          res.status(200).json(statements || []);
      } catch (err) {
          console.error('Error fetching billing statements:', err);
          res.status(500).json({ error: 'Internal server error' });
      }
})
  
  
  
// GET /api/properties/:prop_id/statement_total
router.get('/properties/:prop_id/statement_total', async (req, res) => {
    const { prop_id } = req.params;
  
    try {
      const database = getDb(); // Get the database instance
      const billingStatementsCollection = database.collection('statements'); // Access the 'statements' collection
  
      // Aggregate to sum up all bll_total_amt_due for partial or pending statements of the given property
      const result = await billingStatementsCollection.aggregate([
        { 
          $match: { 
            bll_prop_id: prop_id, // Match the specific property ID
            bll_pay_stat: { $in: ['partial', 'pending'] } // Match partial or pending payment statuses
          } 
        },
        {
          $group: {
            _id: null, // Group all matching documents together
            totalDue: { $sum: "$bll_total_amt_due" } // Sum up the bll_total_amt_due field
          }
        }
      ]).toArray();
  
      // Extract the totalDue or default to 0 if no matching statements are found
      const totalDueDecimal = result.length > 0 ? result[0].totalDue : 0;
  
      // Ensure the totalDueDecimal is converted to a proper number or string
      const totalDue = totalDueDecimal._bsontype === 'Decimal128'
        ? parseFloat(totalDueDecimal.toString()) // Convert Decimal128 to a plain number
        : totalDueDecimal;
  
      res.status(200).json({ totalDue }); // Send the totalDue as a number
    } catch (err) {
      console.error('Error calculating total due:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
});
  
  
  
  // GET /api/properties/:prop_id/latest_statement_water_consump
router.get('/properties/:prop_id/latest_statement_water_consump', async (req, res) => {
    const { prop_id } = req.params;
  
    try {
        const database = getDb(); // Get the database instance
        const billingStatementsCollection = database.collection('statements'); // Access the 'statements' collection
  
        // Query the latest statement for the given property ID based on bll_bill_cov_period_date
        const latestStatement = await billingStatementsCollection
            .find({ bll_prop_id: prop_id }) // Filter by the specific property ID
            .sort({ bll_bill_cov_period_date: -1 }) // Sort by coverage period date in descending order
            .limit(1) // Get the most recent document
            .toArray();
  
        // Check if a statement exists
        if (!latestStatement || latestStatement.length === 0) {
            return res.status(200).json({ bll_water_consump: 0 }); // Return 0 if no statement is found
        }
  
        // Extract the bll_water_consump value from the latest statement
        const { bll_water_consump } = latestStatement[0];
        const data = JSON.parse(JSON.parse(bll_water_consump))
        // Convert all Decimal128 fields to strings, including nested ones
        const propertyResponse = convertDecimal128FieldsToString(data);
        res.status(200).json(propertyResponse);
    } catch (err) {
        console.error('Error fetching latest water consumption:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
  


// ----
// TRANSACTION FUNCTIONS
// ----

// GET /api/transactions - Fetch transactions with detailed information
router.get('/transactions', async (req, res) => {
    try {
      const database = getDb();
      const transactionsCollection = database.collection('transactions'); // Access the 'transactions' collection
  
      // Use aggregation to join with users and statements collections
      const transactions = await transactionsCollection.aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'trn_user_init',
            foreignField: 'usr_id',
            as: 'initiatorDetails'
          }
        },
        { $unwind: { path: '$initiatorDetails', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'users',
            localField: 'trn_status_up',
            foreignField: 'usr_id',
            as: 'statusUpdaterDetails'
          }
        },
        { $unwind: { path: '$statusUpdaterDetails', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'statements',
            localField: 'trn_purp_id',
            foreignField: 'bll_id',
            as: 'statementDetails'
          }
        },
        { $unwind: { path: '$statementDetails', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            trn_id: 1,
            trn_type: 1,
            trn_user_init: {
              $concat: [
                { $ifNull: ['$initiatorDetails.usr_first_name', ''] },
                ' ',
                { $ifNull: ['$initiatorDetails.usr_last_name', ''] }
              ]
            },
            initiatorDetails: 1, // Include raw initiator details for debugging
            trn_created_at: 1,
            trn_purp: 1,
            trn_purp_id: '$statementDetails.bll_id',
            trn_status: 1,
            statusUpdaterDetails: 1, // Include raw status updater details for debugging
            trn_method: 1,
            trn_amount: 1,
            trn_ornum: 1,
            trn_stat_link: '$statementDetails.bll_id',
            trn_image_url: 1
          }
        }
      ]).toArray();
      
      if (!transactions || transactions.length === 0) {
        return res.status(404).json({ error: 'No transactions found' });
      }
      
      const data = JSON.parse(JSON.stringify(transactions))
      // Convert all Decimal128 fields to strings, including nested ones
      const transactionsResponse = data.map(convertDecimal128FieldsToString);
      res.status(200).json(transactionsResponse);
    } catch (err) {
      console.error('[SERVER] Error fetching transactions:', err);
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});



// ----
// WALLET FUNCTIONS
// ----

router.get('/wallet', async (req, res) => {
    try {
      const database = getDb(); // Get the database instance
      const walletCollection = database.collection('villwallet'); // Access the 'wallet' collection
      const wallet = await walletCollection.find({}).toArray(); // Fetch all wallet from the collection
      
      const data = JSON.parse(JSON.stringify(wallet[0]))
      // Convert all Decimal128 fields to strings, including nested ones
      const walletResponse = convertDecimal128FieldsToString(data);
      res.status(200).json(walletResponse);
    } catch (err) {
      console.error('[SERVER] Error fetching data:', err);
      res.status(500).json({ error: 'Failed to fetch data' }); // Handle errors
    }
  })
  

  export default router;