const mongoose = require('mongoose');

const CreatorSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    handle: { type: String, required: true, trim: true },
    platform: { type: String, required: true, enum: ['youtube', 'tiktok'] },
    url: { type: String, required: true, trim: true },
    avatar: { type: String, default: '', trim: true },
    banner: { type: String, default: '', trim: true },
    followers: { type: String, default: '', trim: true },
    order: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

CreatorSchema.pre('save', function(next) {
    this.updated_at = new Date();
    next();
});

module.exports = mongoose.models.Creator || mongoose.model('Creator', CreatorSchema, 'creators');
