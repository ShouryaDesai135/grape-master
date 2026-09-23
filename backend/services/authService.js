/**
 * authService.js — Firebase-Backed Authentication Engine
 * ═══════════════════════════════════════════════════════
 *
 * HOW IT WORKS:
 * 
 * The frontend handles the actual sign-in UI (email/password or Google)
 * using the Firebase client SDK. Once the user signs in, Firebase gives 
 * the frontend an "ID Token" (a short-lived JWT signed by Google).
 *
 * The frontend sends that ID Token to our backend:
 *   POST /api/auth/firebase-verify { idToken }
 *
 * Our backend then:
 *   1. Verifies the ID Token with Firebase Admin SDK (confirms it's legit)
 *   2. Extracts user info (uid, name, email, photoURL)
 *   3. Creates a Farmer record in our SQLite DB if first-time user
 *   4. Issues our OWN JWT — this is used for all subsequent API calls
 *
 * WHY we issue our own JWT instead of using Firebase tokens directly:
 * - Our JWT carries our internal farmer ID, which the DB uses
 * - We control expiry, payload, and don't need Firebase for every request
 * - The backend stays independent of Firebase for all non-auth operations
 *
 * Admin auth (email + bcrypt) is completely separate — admins are
 * pre-provisioned, never go through Firebase.
 */

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  findFarmerByFirebaseUid,
  findFarmerById,
  createFarmer,
  findAdminByEmail,
  createAdmin,
} from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CONFIG ────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';
const BCRYPT_SALT_ROUNDS = 12;

// ─── FIREBASE ADMIN INIT ────────────────────────────────────────
// Reads the service account JSON you placed in the backend folder.
// This lets our server talk to Firebase to verify user tokens.

let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized) return;

  try {
    const serviceAccountPath = path.join(__dirname, '../firebase-service-account.json');
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

    // Only initialize if no app exists yet (safe for hot reloads)
    if (getApps().length === 0) {
      initializeApp({
        credential: cert(serviceAccount),
      });
    }

    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialized.');
  } catch (err) {
    console.error('❌ Firebase Admin SDK failed to initialize:', err.message);
    console.error('   Make sure firebase-service-account.json is in the backend/ folder.');
  }
}

// Initialize on module load
initFirebase();

// ═══════════════════════════════════════════════════════════════
// FARMER: FIREBASE TOKEN VERIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Verify a Firebase ID Token sent from the frontend.
 * On first login, creates the farmer record automatically.
 * Returns our own JWT for all future API calls.
 *
 * @param {string} idToken - Firebase ID token from frontend
 * @param {string} preferredLanguage - Optional, set during registration (en/hi/mr)
 * @returns {{ success, token, isNewUser, farmer }}
 */
export async function verifyFirebaseToken(idToken, preferredLanguage = 'en', fallbackName = null) {
  if (!idToken) {
    return { success: false, error: 'Firebase ID token is required.' };
  }

  if (!firebaseInitialized) {
    return { success: false, error: 'Auth service unavailable. Check server configuration.' };
  }

  let decodedToken;
  try {
    decodedToken = await getAuth().verifyIdToken(idToken);
  } catch (err) {
    console.error('Firebase token verification failed:', err.code);
    return { success: false, error: 'Invalid or expired session. Please log in again.' };
  }

  const { uid, name, email, picture } = decodedToken;

  // Look up farmer in our DB by Firebase UID
  let farmer = findFarmerByFirebaseUid(uid);
  let isNewUser = false;

  if (!farmer) {
    // First time this user logs in — create their account
    const farmerId = uuidv4();
    createFarmer({
      id: farmerId,
      firebaseUid: uid,
      name: name || fallbackName || email?.split('@')[0] || 'Farmer',  // Use fallbackName from frontend if provided
      email: email || '',
      preferredLanguage,
      photoUrl: picture || null,
    });
    farmer = findFarmerById(farmerId);
    isNewUser = true;
    console.log(`🌱 New farmer registered: ${email || uid}`);
  }

  // Generate our own JWT
  const token = generateToken({
    id: farmer.id,
    type: 'farmer',
    email: farmer.email,
    name: farmer.name,
  });

  return {
    success: true,
    token,
    isNewUser,
    farmer: {
      id: farmer.id,
      name: farmer.name,
      email: farmer.email,
      preferredLanguage: farmer.preferred_language,
      region: farmer.region,
      photoUrl: farmer.photo_url,
      consentGiven: !!farmer.consent_given,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// ADMIN: EMAIL + PASSWORD LOGIN
// ═══════════════════════════════════════════════════════════════

/**
 * Authenticate an admin with email + password (bcrypt).
 * Admins are pre-provisioned — no self-signup flow exists.
 *
 * @param {string} email
 * @param {string} password
 * @returns {{ success, token, admin }}
 */
export async function adminLogin(email, password) {
  if (!email || !password) {
    return { success: false, error: 'Email and password are required.' };
  }

  const admin_record = findAdminByEmail(email.toLowerCase().trim());

  if (!admin_record) {
    // Generic message — don't reveal whether the email exists
    return { success: false, error: 'Invalid email or password.' };
  }

  const isValid = await bcrypt.compare(password, admin_record.password_hash);

  if (!isValid) {
    return { success: false, error: 'Invalid email or password.' };
  }

  const token = generateToken({
    id: admin_record.id,
    type: 'admin',
    role: admin_record.role,
    email: admin_record.email,
  });

  return {
    success: true,
    token,
    admin: {
      id: admin_record.id,
      email: admin_record.email,
      fullName: admin_record.full_name,
      role: admin_record.role,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// ADMIN: CREATE ACCOUNT (for seed script only)
// ═══════════════════════════════════════════════════════════════

export async function createAdminAccount({ email, password, fullName, role = 'expert' }) {
  const existing = findAdminByEmail(email.toLowerCase().trim());
  if (existing) {
    return { success: false, error: 'Admin with this email already exists.' };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const id = uuidv4();

  createAdmin({ id, email: email.toLowerCase().trim(), passwordHash, fullName, role });

  console.log(`👤 Admin created: ${email} (role: ${role})`);
  return { success: true, id, email: email.toLowerCase().trim() };
}

// ═══════════════════════════════════════════════════════════════
// JWT UTILITIES
// ═══════════════════════════════════════════════════════════════

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
