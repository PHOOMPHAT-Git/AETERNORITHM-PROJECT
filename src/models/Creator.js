const mongoose = require('mongoose');

const CreatorSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    handle: { type: String, required: true, trim: true },
    platform: { type: String, required: true, enum: ['youtube', 'tiktok'] },
    url: { type: String, required: true, trim: true },
    avatar: { type: String, default: '', trim: true },
    banner: { type: String, default: '', trim: true },
    followers: { type: String, default: '', trim: true },
    subscribers: { type: Number, default: 0, index: true },
    order: { type: Number, default: 0 }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.models.Creator || mongoose.model('Creator', CreatorSchema, 'creators');
