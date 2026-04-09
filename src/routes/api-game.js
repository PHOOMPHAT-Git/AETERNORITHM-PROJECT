const express = require('express');
const router = express.Router();
const PlayerData = require('../models/PlayerData');

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

// POST /api/game/player/batch - Game sends all player data at once
router.post('/player/batch', verifyGameSecret, async (req, res) => {
    try {
        const { players } = req.body;
        console.log(`[API-Game] /player/batch | received: ${Array.isArray(players) ? players.length : 'NOT ARRAY'} players`);

        if (!Array.isArray(players) || players.length === 0) {
            console.log('[API-Game] /player/batch REJECTED - missing or empty array');
            return res.status(400).json({ success: false, error: 'Missing players array' });
        }

        const ops = players.map(p => ({
            updateOne: {
                filter: { roblox_user_id: p.roblox_user_id },
                update: {
                    $set: {
                        roblox_username: p.roblox_username || '',
                        selected_slot: p.selected_slot || 1,
                        created_slots: p.created_slots || [1],
                        settings: p.settings || {},
                        characters: p.characters || {},
                        is_online: true,
                        last_seen: new Date(),
                        updated_at: new Date()
                    }
                },
                upsert: true
            }
        }));

        await PlayerData.bulkWrite(ops);
        console.log(`[API-Game] /player/batch SAVED | ${players.length} players`);
        res.json({ success: true, count: players.length });
    } catch (error) {
        console.error('[API-Game] /player/batch ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/game/player/left - Mark player as offline
router.post('/player/left', verifyGameSecret, async (req, res) => {
    try {
        const { roblox_user_id } = req.body;
        console.log(`[API-Game] /player/left | user: ${roblox_user_id}`);
        if (!roblox_user_id) {
            return res.status(400).json({ success: false, error: 'Missing roblox_user_id' });
        }

        const result = await PlayerData.updateOne(
            { roblox_user_id },
            { $set: { is_online: false, last_seen: new Date(), updated_at: new Date() } }
        );
        console.log(`[API-Game] /player/left DONE | user: ${roblox_user_id} | updated: ${result.modifiedCount}`);

        res.json({ success: true });
    } catch (error) {
        console.error('[API-Game] /player/left ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// GET /api/game/players - Get all players (for dashboard)
router.get('/players', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const User = require('../models/User');
        const user = await User.findById(req.session.user.id);
        if (!user || user.email !== process.env.ADMIN_EMAIL) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const players = await PlayerData.find({}).sort({ is_online: -1, updated_at: -1 }).lean();
        console.log(`[API-Game] /players GET | found: ${players.length} players`);
        res.json({ success: true, players });
    } catch (error) {
        console.error('[API-Game] /players ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
