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

// Fetch Discord members from bot (cached for 60 seconds)
let discordMembersCache = { data: null, fetchedAt: 0 };
async function fetchDiscordMembers() {
    const now = Date.now();
    if (discordMembersCache.data && now - discordMembersCache.fetchedAt < 60000) {
        return discordMembersCache.data;
    }

    const botApiUrl = process.env.BOT_API_URL;
    const botApiSecret = process.env.BOT_API_SECRET;
    if (!botApiUrl || !botApiSecret) return [];

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`${botApiUrl}/members?secret=${encodeURIComponent(botApiSecret)}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) return discordMembersCache.data || [];
        const data = await res.json();
        if (data.success) {
            discordMembersCache = { data: data.members, fetchedAt: now };
            return data.members;
        }
    } catch (err) {
        console.error('[API-Game] Failed to fetch Discord members:', err.message);
    }
    return discordMembersCache.data || [];
}

// GET /api/game/players - Get all Discord members with game/verify data (for dashboard)
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
        const search = (req.query.search || '').trim().toLowerCase();

        // Fetch all data in parallel
        const RobloxVerify = getRobloxVerifyModel();
        const [discordMembers, allVerifyRecords, allWebUsers] = await Promise.all([
            fetchDiscordMembers(),
            RobloxVerify.find({}).lean().catch(() => []),
            User.find({ discord_user_id: { $exists: true, $ne: null } }, { discord_user_id: 1, username: 1, website_linked_at: 1 }).lean().catch(() => [])
        ]);

        // Build maps
        const verifyByDiscord = {};
        for (const v of allVerifyRecords) {
            if (v.discord_user_id) verifyByDiscord[v.discord_user_id] = v;
        }

        const webUserByDiscord = {};
        for (const u of allWebUsers) {
            if (u.discord_user_id) webUserByDiscord[u.discord_user_id] = u;
        }

        // Batch-fetch current Roblox usernames for all verified users
        const robloxIds = allVerifyRecords
            .filter(v => v.status === 'verified' && v.roblox_user_id)
            .map(v => Number(v.roblox_user_id));

        const robloxNameMap = {};
        if (robloxIds.length > 0) {
            try {
                // Roblox API accepts up to 100 IDs per request
                for (let i = 0; i < robloxIds.length; i += 100) {
                    const batch = robloxIds.slice(i, i + 100);
                    const rblxRes = await fetch('https://users.roblox.com/v1/users', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userIds: batch, excludeBannedUsers: false })
                    });
                    if (rblxRes.ok) {
                        const rblxData = await rblxRes.json();
                        for (const u of (rblxData.data || [])) {
                            robloxNameMap[u.id] = u.name;
                        }
                    }
                }

                // Update changed usernames in DB (fire-and-forget)
                for (const v of allVerifyRecords) {
                    const freshName = robloxNameMap[v.roblox_user_id];
                    if (freshName && freshName !== v.roblox_username) {
                        RobloxVerify.updateOne(
                            { discord_user_id: v.discord_user_id },
                            { $set: { roblox_username: freshName } }
                        ).catch(() => {});
                    }
                }
            } catch (err) {
                console.error('[API-Game] Failed to fetch Roblox usernames:', err.message);
            }
        }

        // Build list from Discord members only
        let allEntries = [];

        for (const m of discordMembers) {
            const verify = verifyByDiscord[m.discord_user_id];
            const webUser = webUserByDiscord[m.discord_user_id];

            // Use fresh Roblox username if available, fallback to stored
            const robloxUsername = verify
                ? (robloxNameMap[verify.roblox_user_id] || verify.roblox_username)
                : null;

            allEntries.push({
                _id: 'discord_' + m.discord_user_id,
                discord_user_id: m.discord_user_id,
                discord_username: m.discord_username,
                discord_display_name: m.discord_display_name,
                discord_avatar: m.discord_avatar,
                discord_status: m.discord_status,
                discord_joined_at: m.discord_joined_at,
                // Roblox verify
                roblox_verified: verify ? verify.status === 'verified' : false,
                roblox_username: robloxUsername,
                roblox_user_id: verify ? verify.roblox_user_id : null,
                roblox_verified_at: verify ? verify.verified_at : null,
                // Website verify
                website_linked: !!webUser,
                website_username: webUser ? webUser.username : null,
                website_linked_at: webUser ? webUser.website_linked_at : null
            });
        }

        // Sort: by discord status, then by name
        allEntries.sort((a, b) => {
            const statusOrder = { online: 0, idle: 1, dnd: 2, offline: 3 };
            const sa = statusOrder[a.discord_status] ?? 3;
            const sb = statusOrder[b.discord_status] ?? 3;
            if (sa !== sb) return sa - sb;
            const nameA = (a.discord_display_name || a.discord_username || '').toLowerCase();
            const nameB = (b.discord_display_name || b.discord_username || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Search filter
        if (search) {
            allEntries = allEntries.filter(e => {
                return (e.discord_username && e.discord_username.toLowerCase().includes(search)) ||
                       (e.discord_display_name && e.discord_display_name.toLowerCase().includes(search)) ||
                       (e.roblox_username && e.roblox_username.toLowerCase().includes(search)) ||
                       (e.website_username && e.website_username.toLowerCase().includes(search)) ||
                       (e.discord_user_id && e.discord_user_id.includes(search));
            });
        }

        const total = allEntries.length;
        const totalRobloxVerified = allEntries.filter(e => e.roblox_verified).length;
        const totalWebLinked = allEntries.filter(e => e.website_linked).length;

        // Paginate
        const skip = (page - 1) * limit;
        const paginatedEntries = allEntries.slice(skip, skip + limit);

        console.log(`[API-Game] /players GET | page:${page} limit:${limit} search:"${search}" total:${total}`);
        res.json({
            success: true,
            players: paginatedEntries,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            stats: {
                total,
                roblox_verified: totalRobloxVerified,
                website_linked: totalWebLinked
            }
        });
    } catch (error) {
        console.error('[API-Game] /players ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
