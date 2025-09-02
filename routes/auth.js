const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PrivateItem = require('../models/PrivateItem');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change';

// register (not exposed in UI but useful for initial seed)
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'username and password required' });
  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ message: 'user exists' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash: hash });
    return res.json({ ok: true, id: user._id });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'username and password required' });
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// middleware for protected routes
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: 'no auth' });
  const parts = header.split(' ');
  if (parts.length !== 2) return res.status(401).json({ message: 'malformed' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'invalid token' });
  }
}

// sample protected route returning private items
// list items for the authenticated user
router.get('/private', authMiddleware, async (req, res) => {
  try {
    const items = await PrivateItem.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, items });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// create a new private item
router.post('/private', authMiddleware, async (req, res) => {
  const { type, title, content, url } = req.body;
  if (!type || !title) return res.status(400).json({ message: 'type and title required' });
  try {
    const item = await PrivateItem.create({ userId: req.user.id, type, title, content, url });
    return res.json({ ok: true, item });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// update an item (only owner)
router.put('/private/:id', authMiddleware, async (req, res) => {
  try {
    const item = await PrivateItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'not found' });
    if (String(item.userId) !== String(req.user.id)) return res.status(403).json({ message: 'forbidden' });
    const { type, title, content, url } = req.body;
    if (type) item.type = type;
    if (title) item.title = title;
    if (typeof content !== 'undefined') item.content = content;
    if (typeof url !== 'undefined') item.url = url;
    await item.save();
    return res.json({ ok: true, item });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// delete an item (only owner)
router.delete('/private/:id', authMiddleware, async (req, res) => {
  try {
    // delete atomically and ensure the item belongs to the authenticated user
    const deleted = await PrivateItem.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!deleted) return res.status(404).json({ message: 'not found or not authorized' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /private/:id error', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: err.message || 'internal error' });
  }
});

module.exports = router;
