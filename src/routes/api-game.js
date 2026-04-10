const express = require('express');
const router = express.Router();
const PlayerData = require('../models/PlayerData');
const { getRobloxVerifyModel } = require('../models/RobloxVerify');

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

// POST /api/game/player/batch
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

// GET /api/game/players - Get players with pagination and search (for dashboard)
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

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
        const search = (req.query.search || '').trim();
        const skip = (page - 1) * limit;

        const filter = {};
        if (search) {
            const searchNum = Number(search);
            if (!isNaN(searchNum) && String(searchNum) === search) {
                filter.$or = [
                    { roblox_username: { $regex: search, $options: 'i' } },
                    { roblox_user_id: searchNum }
                ];
            } else {
                filter.roblox_username = { $regex: search, $options: 'i' };
            }
        }

        const [players, total, totalOnline] = await Promise.all([
            PlayerData.find(filter, { settings: 0 }).sort({ is_online: -1, updated_at: -1 }).skip(skip).limit(limit).lean(),
            PlayerData.countDocuments(filter),
            PlayerData.countDocuments({ ...filter, is_online: true })
        ]);

        // Lookup Discord verification data for each player
        const robloxIds = players.map(p => p.roblox_user_id);
        const RobloxVerify = getRobloxVerifyModel();
        const verifyRecords = await RobloxVerify.find({
            roblox_user_id: { $in: robloxIds }
        }).lean().catch(() => []);

        // Build a map: roblox_user_id -> verify record
        const verifyMap = {};
        for (const v of verifyRecords) {
            verifyMap[v.roblox_user_id] = v;
        }

        // Lookup website link data for verified discord users
        const discordIds = verifyRecords
            .filter(v => v.discord_user_id)
            .map(v => v.discord_user_id);

        let userMap = {};
        if (discordIds.length > 0) {
            const linkedUsers = await User.find({
                discord_user_id: { $in: discordIds }
            }, { discord_user_id: 1, username: 1 }).lean().catch(() => []);
            for (const u of linkedUsers) {
                userMap[u.discord_user_id] = u;
            }
        }

        // Attach verify & website info to each player
        const enrichedPlayers = players.map(p => {
            const verify = verifyMap[p.roblox_user_id];
            const result = { ...p };
            if (verify) {
                result.discord_user_id = verify.discord_user_id;
                result.roblox_verified = verify.status === 'verified';
                result.verified_at = verify.verified_at;
                const websiteUser = userMap[verify.discord_user_id];
                if (websiteUser) {
                    result.website_linked = true;
                    result.website_username = websiteUser.username;
                } else {
                    result.website_linked = false;
                }
            } else {
                result.roblox_verified = false;
                result.website_linked = false;
            }
            return result;
        });

        console.log(`[API-Game] /players GET | page:${page} limit:${limit} search:"${search}" found:${total}`);
        res.json({
            success: true,
            players: enrichedPlayers,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            stats: { total, online: totalOnline, offline: total - totalOnline }
        });
    } catch (error) {
        console.error('[API-Game] /players ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
