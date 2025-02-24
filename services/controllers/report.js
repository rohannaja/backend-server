import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import tinify from 'tinify';
import { ObjectId, Decimal128 } from 'mongodb';
import {getDb} from '../db/db.js';
import 'dotenv/config'; // Load environment variables


const router = express.Router();
router.get('/', async (req, res) => {
  const { type, status } = req.query;

  try {
      const database = getDb();
      const reportsCollection = database.collection('reports');

      // Build query dynamically based on provided filters
      const query = {};
      if (type) query.rpt_type = type;
      if (status) query.rpt_status = status;

      // Fetch reports from the database
      const reports = await reportsCollection.find(query).toArray();

      // If no reports found, return a 404 response
      // if (!reports.length) {
      //     return res.status(404).json({ error: 'No reports found' });
      // }

      // Return the reports
      res.status(200).json(reports);
  } catch (err) {
      console.error('Error fetching reports:', err);
      res.status(500).json({ error: 'Internal server error' });
  }
});

  router.put('/:reportId', async (req, res) => {
    const { reportId } = req.params;
    const {status} = req.body
    
    try {
      const database = getDb();
      const reportsCollection = database.collection('reports');
      // Find the user by username
      const report = await reportsCollection.findOne({_id: new ObjectId(reportId)})
    
      if (!report) {
        return res.status(400).json({ error: 'No report found' });
      }

      const UpdatedReport = await reportsCollection.updateOne({_id: new ObjectId(reportId)}, {
        $set: {
          rpt_status: status
        }
      })

      // Remove sensitive fields
      // If valid, return the user object with relevant fields
      res.status(200).json(UpdatedReport);
    } catch (err) {
      console.error('Error fetching reports:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });


  export default router;
