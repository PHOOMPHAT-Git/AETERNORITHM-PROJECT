const mongoose = require('mongoose');

const GameCharacterSchema = new mongoose.Schema({
    roblox_user_id: { type: Number, required: true },
    roblox_username: { type: String, default: '' },
    slot: { type: Number, required: true },
    character_name: { type: String, default: '' },
    gender: { type: String, default: '' },
    level: { type: Number, default: 1 },
    experience: { type: Number, default: 0 },
    nex: { type: Number, default: 0 },
    age: { type: Number, default: 18 },
    bounty: { type: Number, default: 0 },
    attribute_points: { type: Number, default: 0 },
    investment_points: { type: Number, default: 0 },
    current_weapon: { type: String, default: '' },
    current_arcis: { type: String, default: '' },
    journal: {
        body: { type: Object, default: {} },
        weapons: { type: Object, default: {} },
        resistances: { type: Object, default: {} },
        arcis: { type: Object, default: {} },
        hunger: { type: Object, default: { now: 100, max: 100 } },
        water: { type: Object, default: { now: 100, max: 100 } },
        senses: { type: Object, default: { now: 100, max: 100 } },
        posture: { type: Object, default: { now: 0, max: 30 } },
        armor: { type: Object, default: { now: 100, max: 100 } },
        essence: { type: Object, default: { now: 100, max: 100 } }
    },
    talents: { type: Object, default: {} },
    backpack: {
        max: { type: Number, default: 100 },
        items: { type: Object, default: {} }
    },
    is_online: { type: Boolean, default: false },
    last_seen: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

GameCharacterSchema.index({ roblox_user_id: 1, slot: 1 }, { unique: true });

module.exports = mongoose.models.GameCharacter || mongoose.model('GameCharacter', GameCharacterSchema, 'game_characters');
