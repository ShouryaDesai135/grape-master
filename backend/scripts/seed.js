/**
 * seed.js — Database Seeding Script
 * ══════════════════════════════════
 * 
 * Run with: npm run seed
 * 
 * Creates:
 * 1. A default admin account (admin@grapemaster.ai / admin123)
 * 2. A default expert account (expert@grapemaster.ai / expert123)
 * 
 * Safe to run multiple times — skips if accounts already exist.
 * 
 * IMPORTANT: Change these passwords before any production deployment!
 */

import 'dotenv/config';
import { initDatabase } from '../database.js';
import { createAdminAccount } from '../services/authService.js';

async function seed() {
  console.log('🌱 Seeding database...\n');

  if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_DEFAULT_PASSWORD || !process.env.EXPERT_DEFAULT_PASSWORD)) {
    console.error('❌ Refusing to seed default passwords in NODE_ENV=production. Set ADMIN_DEFAULT_PASSWORD and EXPERT_DEFAULT_PASSWORD.');
    process.exit(1);
  }

  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
  const expertPassword = process.env.EXPERT_DEFAULT_PASSWORD || 'expert123';

  // Initialize database (creates tables if they don't exist)
  initDatabase();

  // Create default admin
  const admin = await createAdminAccount({
    email: 'admin@grapemaster.ai',
    password: adminPassword,
    fullName: 'System Administrator',
    role: 'admin'
  });
  if (admin.success) {
    console.log('  ✅ Admin created: admin@grapemaster.ai');
  } else {
    console.log('  ⏭️  Admin already exists: admin@grapemaster.ai');
  }

  // Create default expert reviewer
  const expert = await createAdminAccount({
    email: 'expert@grapemaster.ai',
    password: expertPassword,
    fullName: 'Agricultural Expert',
    role: 'expert'
  });
  if (expert.success) {
    console.log('  ✅ Expert created: expert@grapemaster.ai');
  } else {
    console.log('  ⏭️  Expert already exists: expert@grapemaster.ai');
  }

  console.log('\n✅ Seeding complete!\n');
  console.log('⚠️  REMINDER: Change default passwords (via ADMIN_DEFAULT_PASSWORD / EXPERT_DEFAULT_PASSWORD) before production deployment.');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seeding failed:', err.message);
  process.exit(1);
});
