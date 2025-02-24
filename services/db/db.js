//services/db.js


import { MongoClient } from 'mongodb';
import 'dotenv/config'; // Load environment variables
  // Load environment variables from .env

const uri = process.env.MG_URI;  // MongoDB connection string from the .env file
let client;
let db;

const options = {
    maxPoolSize: 5,  // Set the pool size for MongoDB
};

// Connect to the MongoDB server
const connectToServer = async () => {
    if (!client) {
        client = new MongoClient(uri, options);
        await client.connect();
        db = client.db("cvconnect");  // Ensure you're connecting to the correct database
        console.log('[DB] Connected to database server with connection pooling');
    }
};

// Get the database instance
const getDb = () => {
    if (!db) {
        throw new Error('[DB] Database not initialized. Call connectToServer first.');
    }
    return db;
};

// Close the MongoDB connection
const closeConnection = async () => {
    if (client) {
        await client.close();
        console.log('[DB] Connection to MongoDB closed');
    }
};

export { connectToServer, getDb, closeConnection };