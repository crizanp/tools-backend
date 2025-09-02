const mongoose = require('mongoose');

const PrivateItemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true }, // password, base64, note, photo, doc, file, imp-photo
  title: { type: String, required: true },
  content: { type: String }, // server-stored content for password/base64/notes
  url: { type: String }, // link for photo/doc/file
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

PrivateItemSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('PrivateItem', PrivateItemSchema);
