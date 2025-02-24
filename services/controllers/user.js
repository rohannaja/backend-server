import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import tinify from 'tinify';
import { ObjectId, Decimal128 } from 'mongodb';
import {getDb} from '../db/db.js';
import 'dotenv/config'; // Load environment variables
import {convertDecimal128FieldsToString} from "../../lib/utils.js"

const router = express.Router();
router.get('/', async (req, res) => {
    const { role } = req.query;
    
    try {
      const database = getDb();
      const usersCollection = database.collection('users');
      const query = role ? { usr_role: role } : {};
      // Find the user by username
      let users = await usersCollection.find(query).toArray();
    
      if (!users.length) {
        return res.status(400).json({ error: 'No users found' });
    }
      
      // Remove sensitive fields
      users.forEach(user => delete user.usr_password);

      // If valid, return the user object with relevant fields
      res.status(200).json(users);
    } catch (err) {
      console.error('Error fetching users:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });


  router.get('/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
      const database = getDb();
      const usersCollection = database.collection('users');
      const query = { usr_id: userId }
      // Find the user by username
      let user = await usersCollection.findOne(query);
    
      if (!user) {
        return res.status(400).json({ error: 'No user found' });
    }

      // If valid, return the user object with relevant fields
      res.status(200).json(user);
    } catch (err) {
      console.error('Error fetching users:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:userId/wallet', async (req, res) => {
    const { userId } = req.params;
    
    try {
      const database = getDb();
      const usersCollection = database.collection('users');
      const walletCollection = database.collection('wallet');
      // Find the user by username
    
      if (!userId) {
        return res.status(404).json({ error: 'User ID Not Found' });
     }

     const user = await usersCollection.findOne({usr_id:userId })

     if(!user) {
      return res.status(404).json({ error: 'User Not FOund' });
     }
      
     const wallet = await walletCollection.findOne({wall_owner:userId })
     
     if(!wallet) {
       return res.status(404).json({ error: 'Wallet Not FOund' });
      }
      const data = JSON.parse(JSON.stringify(wallet))
      const walletData = convertDecimal128FieldsToString(data)
      // If valid, return the user object with relevant fields
      return res.status(200).json(walletData);
    } catch (err) {
      console.error('Error fetching users:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });



  export default router;
