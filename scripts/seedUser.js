require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

let MONGO_URI = process.env.MONGO_URI;

// If .env wasn't created but .env.example exists, try to read it for MONGO_URI
if (!MONGO_URI) {
  try {
    const examplePath = path.join(__dirname, '..', '.env.example');
    if (fs.existsSync(examplePath)) {
      const content = fs.readFileSync(examplePath, 'utf8');
      const match = content.match(/^MONGO_URI=(.*)$/m);
      if (match) {
        MONGO_URI = match[1].trim();
      }
    }
  } catch (e) {
    // ignore and let the missing check below handle it
  }
}

async function run() {
  if (!MONGO_URI) {
    console.error('MONGO_URI is not set. Create a `.env` file (copy `.env.example`) and set MONGO_URI.');
    console.error('PowerShell: Copy-Item .env.example .env');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const username = 'srijanpokhrel';
  const password = 'sriiaiskn112...';
  const existing = await User.findOne({ username });
  if (existing) {
    console.log('User exists, skipping');
    process.exit(0);
  }
  const hash = await bcrypt.hash(password, 10);
  await User.create({ username, passwordHash: hash });
  console.log('Seeded user', username);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
