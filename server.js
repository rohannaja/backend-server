import express from 'express';
import {connectToServer} from './services/db/db.js'; // Ensure this path is correct
import homeOwner from './services/controllers/homeOwner.js';
import admin from './services/controllers/admin.js';
import auth from './services/controllers/auth.js';
import user from './services/controllers/user.js';
import officer from './services/controllers/officer.js';
import transaction from './services/controllers/transaction.js';
import property from './services/controllers/property.js';
import report from './services/controllers/report.js';
import cors from 'cors';
import dotenv from 'dotenv';
import { ExpressAuth } from '@auth/express';
import Credentials from '@auth/core/providers/credentials';
import bcrypt from 'bcryptjs';
import { getSession } from "@auth/express"
dotenv.config();

const port = process.env.PORT || 8080;

const startServer = async () => {
  try {
    await connectToServer(); // ✅ Connect to MongoDB inside an async function
    console.log('[SERVER] Database connection successful');

    const app = express();

    const allowedOrigins = [
      'http://localhost:5030',
      'http://localhost:5031',
      'https://sb3.cvconnect.app',
      'https://owner.cvconnect.app',
      'http://localhost:3010',
      'http://localhost:3011',
      'https://sb1.cvconnect.app',
      'https://admin.cvconnect.app'
    ];

    const corsOptions = {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    };

    app.set('trust proxy', true);
    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // const users = [
    //   { id: '1', username: 'dummyadmin2', password: bcrypt.hashSync('dummyadmin2', 10) }
    // ];

    // ✅ Use ExpressAuth middleware properly
    // app.use(ExpressAuth({
    //   providers: [
    //     Credentials({
    //       name: 'credentials',
    //       credentials: {
    //         username: { label: "username", type: "text" },
    //         password: { label: "password", type: "password" },
    //       },
    //       async authorize(credentials) {
    //         console.log("body",credentials )
    //         const user = users.find(u => u.username === credentials.username);

    //         if (!user || !bcrypt.compareSync(credentials.password, user.password)) {
    //           throw new Error('Invalid credentials');
    //         }
    //         return { id: user.id, name: user.username, hotdog:true };
    //       }
    //     })
    //   ],
    //   csrf: false, // ❗ Only for debugging; do not use in production
    //   trustHost: true,
    //   secret: process.env.AUTH_SECRET || 'your_secret_key',
    //   session: { strategy: 'jwt' },
    //   debug: true,
    //   callbacks: {
    //     async jwt({ token, user }) {
    //       if (user) {
    //         token.id = user.id;
    //       }
    //       return token;
    //     },
    //     async session({ session, token }) {
    //       session.user.id = token.id;
    //       session.hotdog = true

    //       return {session, token};
    //     }
    //   }
    // }));

    app.use('/api/admin', admin);
    app.use('/api/home-owner', homeOwner);
    app.use('/api/officer', officer);
    app.use('/api/auth', auth);
    app.use('/api/user', user);
    app.use('/api/transaction', transaction);
    app.use('/api/property', property);
    app.use('/api/report', report);
    app.listen(port, () => {
      console.log(`[SERVER] Ready on http://localhost:${port}`);
    });

  } catch (err) {
    console.error('[SERVER] Failed to start:', err);
  }
};

startServer(); // ✅ Call the function
