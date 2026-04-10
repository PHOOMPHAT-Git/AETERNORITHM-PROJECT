const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, default: null },
    token: { type: String, required: true, unique: true },
    roblox_user_id: { type: Number, default: null },
    discord_user_id: { type: String, default: null, unique: true, sparse: true },
    settings: {
        hide_email: { type: Boolean, default: true }
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema, 'users');