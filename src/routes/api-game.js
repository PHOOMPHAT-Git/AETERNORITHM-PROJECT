const express = require('express');
const router = express.Router();
const GameCharacter = require('../models/GameData');

// Middleware: verify game API secret
function verifyGameSecret(req, res, next) {
    const secret = req.headers['x-api-secret'] || req.query.secret;
    console.log(`[API-Game] ${req.method} ${req.originalUrl} | secret: ${secret ? secret.slice(0, 8) + '...' : 'MISSING'} | expected: ${process.env.GAME_API_SECRET ? process.env.GAME_API_SECRET.slice(0, 8) + '...' : 'NOT SET'}`);
    if (!secret || secret !== process.env.GAME_API_SECRET) {
        console.log('[API-Game] Auth FAILED - secret mismatch');
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    console.log('[API-Game] Auth OK');
    next();
}

// POST /api/game/character - Game sends character data
router.post('/character', verifyGameSecret, async (req, res) => {
    try {
        const { roblox_user_id, roblox_username, slot, data } = req.body;
        console.log(`[API-Game] /character | user: ${roblox_user_id} (${roblox_username}) | slot: ${slot} | has data: ${!!data}`);

        if (!roblox_user_id || slot === undefined || !data) {
            console.log('[API-Game] /character REJECTED - missing fields');
            return res.status(400).json({ success: false, error: 'Missing required fields: roblox_user_id, slot, data' });
        }

        const update = {
            roblox_username: roblox_username || '',
            character_name: data.character_name || `${data.first_name || ''} ${data.last_name || ''}`.trim(),
            gender: data.gender || '',
            level: data.level || 1,
            experience: data.experience || 0,
            nex: data.nex || 0,
            age: data.age || 18,
            bounty: data.bounty || 0,
            attribute_points: data.attribute_points || 0,
            investment_points: data.investment_points || 0,
            current_weapon: data.current_weapon || '',
            current_arcis: data.current_arcis || '',
            journal: data.journal || {},
            talents: data.talents || {},
            backpack: data.backpack || {},
            is_online: true,
            last_seen: new Date(),
            updated_at: new Date()
        };

        const result = await GameCharacter.findOneAndUpdate(
            { roblox_user_id, slot },
            { $set: update },
            { upsert: true, new: true }
        );
        console.log(`[API-Game] /character SAVED | ${roblox_username} slot ${slot} | level: ${update.level} | char: ${update.character_name}`);

        res.json({ success: true });
    } catch (error) {
        console.error('[API-Game] /character ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/game/character/batch - Game sends multiple characters at once
router.post('/character/batch', verifyGameSecret, async (req, res) => {
    try {
        const { characters } = req.body;
        console.log(`[API-Game] /character/batch | received: ${Array.isArray(characters) ? characters.length : 'NOT ARRAY'} characters`);
        if (Array.isArray(characters) && characters.length > 0) {
            characters.forEach((c, i) => {
                console.log(`[API-Game]   [${i}] user: ${c.roblox_user_id} (${c.roblox_username}) | slot: ${c.slot} | char: ${c.data?.character_name || 'N/A'} | level: ${c.data?.level || 'N/A'}`);
            });
        }
        if (!Array.isArray(characters) || characters.length === 0) {
            console.log('[API-Game] /character/batch REJECTED - missing or empty array');
            return res.status(400).json({ success: false, error: 'Missing characters array' });
        }

        const ops = characters.map(char => ({
            updateOne: {
                filter: { roblox_user_id: char.roblox_user_id, slot: char.slot },
                update: {
                    $set: {
                        roblox_username: char.roblox_username || '',
                        character_name: char.data?.character_name || `${char.data?.first_name || ''} ${char.data?.last_name || ''}`.trim(),
                        gender: char.data?.gender || '',
                        level: char.data?.level || 1,
                        experience: char.data?.experience || 0,
                        nex: char.data?.nex || 0,
                        age: char.data?.age || 18,
                        bounty: char.data?.bounty || 0,
                        attribute_points: char.data?.attribute_points || 0,
                        investment_points: char.data?.investment_points || 0,
                        current_weapon: char.data?.current_weapon || '',
                        current_arcis: char.data?.current_arcis || '',
                        journal: char.data?.journal || {},
                        talents: char.data?.talents || {},
                        backpack: char.data?.backpack || {},
                        is_online: true,
                        last_seen: new Date(),
                        updated_at: new Date()
                    }
                },
                upsert: true
            }
        }));

        await GameCharacter.bulkWrite(ops);
        console.log(`[API-Game] /character/batch SAVED | ${characters.length} characters`);
        res.json({ success: true, count: characters.length });
    } catch (error) {
        console.error('[API-Game] /character/batch ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/game/player-left - Mark player as offline
router.post('/player-left', verifyGameSecret, async (req, res) => {
    try {
        const { roblox_user_id } = req.body;
        console.log(`[API-Game] /player-left | user: ${roblox_user_id}`);
        if (!roblox_user_id) {
            return res.status(400).json({ success: false, error: 'Missing roblox_user_id' });
        }

        const result = await GameCharacter.updateMany(
            { roblox_user_id },
            { $set: { is_online: false, last_seen: new Date(), updated_at: new Date() } }
        );
        console.log(`[API-Game] /player-left DONE | user: ${roblox_user_id} | updated: ${result.modifiedCount} characters`);

        res.json({ success: true });
    } catch (error) {
        console.error('[API-Game] /player-left ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/game/characters - Get all characters (for dashboard)
router.get('/characters', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const User = require('../models/User');
        const user = await User.findById(req.session.user.id);
        if (!user || user.email !== process.env.ADMIN_EMAIL) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const characters = await GameCharacter.find({}).sort({ is_online: -1, updated_at: -1 }).lean();
        console.log(`[API-Game] /characters GET | found: ${characters.length} characters`);
        res.json({ success: true, characters });
    } catch (error) {
        console.error('[API-Game] /characters ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
