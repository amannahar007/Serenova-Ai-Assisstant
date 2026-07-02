const mongoose = require('mongoose');

const MemorySchema = new mongoose.Schema({
    userId: {
        type: String,
        default: 'default_user'
    },
    key: {
        type: String,
        required: true,
        index: true
    },
    value: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['fact', 'preference', 'event', 'instruction'],
        default: 'fact'
    },
    importance: {
        type: Number,
        min: 1,
        max: 10,
        default: 5
    },
    metadata: {
        type: Object,
        default: {}
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

MemorySchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Memory', MemorySchema);
