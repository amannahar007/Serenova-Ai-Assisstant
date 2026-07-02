const mongoose = require('mongoose');

const CacheSchema = new mongoose.Schema({
  cacheKey: {
    type: String,
    required: true,
    unique: true
  },
  response: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '7d' // Auto-delete cache after 7 days to save space
  }
});

module.exports = mongoose.model('Cache', CacheSchema);
