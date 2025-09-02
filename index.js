
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const imageRoutes = require('./routes/image');
const pdfRoutes = require('./routes/pdfConverter');

const app = express();

// Normalize repeated slashes in the URL (e.g. //api -> /api) to avoid
// platform or proxy redirects which break CORS preflight requests.
app.use((req, res, next) => {
  if (req.url && req.url.includes('//')) {
    req.url = req.url.replace(/\/\/+/g, '/');
  }
  next();
});

// Use permissive CORS for development and allow preflight requests.
// `origin: true` echoes the requesting origin which is safer than `*`
// when credentials are used. For a strict production policy, replace
// with an explicit origin whitelist.
app.use(cors({ origin: true, methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'], allowedHeaders: ['Content-Type','Authorization','Accept','X-Requested-With'], credentials: true }));
app.options('*', cors({ origin: true }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
let MONGO_URI = process.env.MONGO_URI;

// If MONGO_URI is not set, try to read it from .env.example to help local runs
if (!MONGO_URI) {
  try {
    const examplePath = path.join(__dirname, '.env.example');
    if (fs.existsSync(examplePath)) {
      const content = fs.readFileSync(examplePath, 'utf8');
      const match = content.match(/^MONGO_URI=(.*)$/m);
      if (match) {
        MONGO_URI = match[1].trim();
        console.warn('MONGO_URI not found in .env — using value from .env.example');
      }
    }
  } catch (e) {
    // ignore and handle below
  }
}

if (!MONGO_URI) {
  console.error('MONGO_URI is not configured. Please create a `.env` file (copy `.env.example`) and set MONGO_URI.');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err.message));

app.use('/api/auth', authRoutes);
app.use('/api/image', imageRoutes);
app.use('/tools/pdf-converter', pdfRoutes);

app.get('/', (req, res) => res.send({ ok: true }));

// Global error handler to convert multer errors to JSON responses
app.use((err, req, res, next) => {
  if (!err) return next();
  // Multer errors
  if (err instanceof multer.MulterError) {
    let message = err.message || 'File upload error';
    // normalize common codes
    if (err.code === 'LIMIT_FILE_SIZE') message = 'File too large';
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') message = 'Too many files uploaded';
    return res.status(400).json({ error: message });
  }
  // Fallback JSON for other errors
  console.error('Unhandled error', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// When this file is run directly (node index.js) we start the server.
// When imported (for example by Vercel serverless functions under /api),
// we export the Express `app` without starting a listener.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
