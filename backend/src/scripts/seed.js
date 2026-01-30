require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGODB_URI = process.env.MONGODB_URI;

async function seed() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if user already exists
    const email = 'umair.khan@bnbyond.com';
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });

    if (existingUser) {
      console.log('User already exists, updating password...');
      existingUser.passwordHash = '12344321';
      await existingUser.save();
      console.log('Password updated successfully');
      console.log(`User ID: ${existingUser._id}`);
      console.log(`User Email: ${existingUser.email}`);
    } else {
      // Create new user
      const user = new User({
        name: 'Umair Khan',
        email: email.toLowerCase().trim(),
        passwordHash: '12344321',
      });
      await user.save();
      console.log('User created successfully');
      console.log(`User ID: ${user._id}`);
      console.log(`User Email: ${user.email}`);
    }

    // Verify user exists
    const verifyUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (verifyUser) {
      console.log(`\n✓ Verified: User found in database`);
      console.log(`  Database: ${mongoose.connection.db.databaseName}`);
      console.log(`  Collection: ${User.collection.name}`);
    } else {
      console.log(`\n✗ Error: User not found after creation!`);
    }

    console.log('\n--- User Details ---');
    console.log('Email: umair.khan@bnbyond.com');
    console.log('Password: 12344321');
    console.log('--------------------\n');

    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
}

seed();
