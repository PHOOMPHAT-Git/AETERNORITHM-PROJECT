const mongoose = require('mongoose');

const PlayerDataSchema = new mongoose.Schema({
    roblox_user_id: { type: Number, required: true, unique: true },
    roblox_username: { type: String, default: '' },
    selected_slot: { type: Number, default: 1 },
    created_slots: { type: [Number], default: [1] },
    settings: { type: Object, default: {} },
    is_online: { type: Boolean, default: false },
    last_seen: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

PlayerDataSchema.index({ roblox_user_id: 1 }, { unique: true });
PlayerDataSchema.index({ roblox_username: 1 });
PlayerDataSchema.index({ is_online: 1, updated_at: -1 });

module.exports = mongoose.models.PlayerData || mongoose.model('PlayerData', PlayerDataSchema, 'player_data');
