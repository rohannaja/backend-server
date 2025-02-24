// services/db/authRoutes.js
import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import tinify from 'tinify';
import { ObjectId, Decimal128 } from 'mongodb';
import {getDb} from '../db/db.js';
import 'dotenv/config'; // Load environment variables

const router = express.Router();
router.put("/:propId", async (req, res) => {
  const { propId } = req.params;
  const { lot, image, street, homeOwnerId } = req.body;
  console.log(lot, image, street, homeOwnerId, image)
  try {
    const database = getDb();
    const propertiesCollection = database.collection("properties");
    const usersCollection = database.collection("users");
    // Find the user by username
    const property = await propertiesCollection.findOne({ prop_id: propId });

    if (!property || !property.prop_id) {
      return res.status(404).json({ message: "Property not found" });
    }

    const newHomeOwner = await usersCollection.findOne({usr_id:homeOwnerId, usr_role:"homeowner" })

    if(!newHomeOwner || !newHomeOwner.usr_id) {
      return res.status(404).json({ message: "Home owner not found" });
    }

    const updateFields = {
      prop_lot_num: lot,
      prop_image_url: image ?? "https://cdn.cvconnect.app/cvhouse_default.jpg",
      prop_street: street,
      prop_owner_id: homeOwnerId,
      prop_owner_lastname: newHomeOwner.usr_last_name,
      prop_owner: newHomeOwner?._id
    };

    const updatedProperty = await propertiesCollection.findOneAndUpdate(
      { prop_id: property?.prop_id },
      { $set: updateFields },
      { returnDocument: "after", returnNewDocument: true }
    );

    res.status(200).json(updatedProperty);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;