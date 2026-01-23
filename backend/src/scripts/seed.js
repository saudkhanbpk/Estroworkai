require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const MONGODB_URI = "mongodb+srv://saudkhanbpk_db_user:dtM4BqDbJMen3f1D@cluster0.lwuztoy.mongodb.net/?appName=Cluster0" 

async function seed() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if user already exists
    const existingUser = await User.findOne({ email: 'umair.khan@bnbyond.com' });

    if (existingUser) {
      console.log('User already exists, updating password...');
      existingUser.passwordHash = '12344321';
      await existingUser.save();
      console.log('Password updated successfully');
    } else {
      // Create new user
      const user = new User({
        name: 'Umair Khan',
        email: 'umair.khan@bnbyond.com',
        passwordHash: '12344321',
      });
      await user.save();
      console.log('User created successfully');
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
