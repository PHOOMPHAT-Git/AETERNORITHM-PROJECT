const mongoose = require('mongoose');
const { getDiscordConnection } = require('../config/db');

const robloxVerifySchema = new mongoose.Schema({
    discord_user_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    roblox_user_id: {
        type: Number,
        required: true
    },
    guild_id: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['verified', 'unverified'],
        default: 'verified'
    },
    verified_at: {
        type: Date,
        default: Date.now
    },
    role_assigned: {
        type: Boolean,
        default: false
    }
});

// Use Discord database connection so Bot and Website share the same data
let cachedModel = null;
function getRobloxVerifyModel() {
    if (cachedModel) return cachedModel;
    const discordConn = getDiscordConnection();
    if (discordConn) {
        cachedModel = discordConn.model('RobloxVerify', robloxVerifySchema, 'roblox_verify');
    } else {
        // Fallback to default connection
        cachedModel = mongoose.model('RobloxVerify', robloxVerifySchema, 'roblox_verify');
    }
    return cachedModel;
}

module.exports = { getRobloxVerifyModel, robloxVerifySchema };
