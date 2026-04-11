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
                website_linked_at: webUser ? webUser.website_linked_at : null,
                // Moderation (passed through from bot)
                warn_level: Number(m.warn_level || 0),
                warn_reason: m.warn_reason || '',
                warned_at: m.warned_at || null,
                banned: !!m.banned,
                ban_reason: m.ban_reason || '',
                banned_at: m.banned_at || null,
                is_in_guild: m.is_in_guild !== false
            });
        }

        // Sort: most recent server join first
        allEntries.sort((a, b) => {
            const dateA = a.discord_joined_at ? new Date(a.discord_joined_at).getTime() : 0;
            const dateB = b.discord_joined_at ? new Date(b.discord_joined_at).getTime() : 0;
            return dateB - dateA;
        });

        // Compute stats from ALL entries (before search filter)
        const totalAll = allEntries.length;
        const totalRobloxVerified = allEntries.filter(e => e.roblox_verified).length;
        const totalWebLinked = allEntries.filter(e => e.website_linked).length;
        const totalWarned = allEntries.filter(e => e.warn_level > 0).length;
        const totalBanned = allEntries.filter(e => e.banned).length;

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

        // Paginate
        const skip = (page - 1) * limit;
        const paginatedEntries = allEntries.slice(skip, skip + limit);

        console.log(`[API-Game] /players GET | page:${page} limit:${limit} search:"${search}" total:${total}`);
        res.json({
            success: true,
            players: paginatedEntries,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            stats: {
                total: totalAll,
                roblox_verified: totalRobloxVerified,
                website_linked: totalWebLinked,
                warned: totalWarned,
                banned: totalBanned
            }
        });
    } catch (error) {
        console.error('[API-Game] /players ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Notify Discord bot to sync roles after admin edit (fire-and-forget, best-effort)
async function notifyBotSyncVerify(discordUserId, action) {
    const botApiUrl = process.env.BOT_API_URL;
    const botApiSecret = process.env.BOT_API_SECRET;
    if (!botApiUrl || !botApiSecret) {
        console.warn('[API-Game] Bot sync skipped: BOT_API_URL or BOT_API_SECRET not set');
        return { ok: false, reason: 'not_configured' };
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(`${botApiUrl}/sync-verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                discord_user_id: String(discordUserId),
                action,
                secret: botApiSecret
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.warn(`[API-Game] Bot sync-verify ${res.status}:`, data.error || 'unknown');
            return { ok: false, reason: data.error || `http_${res.status}` };
        }
        console.log(`[API-Game] Bot sync-verify OK | ${discordUserId} → ${action} | applied:[${(data.applied || []).join(',')}] removed:[${(data.removed || []).join(',')}]`);
        return { ok: true, data };
    } catch (err) {
        console.warn('[API-Game] Bot sync-verify failed:', err.message);
        return { ok: false, reason: err.message };
    }
}

// PUT /api/game/players/:discordUserId - Update Roblox verify data (admin only)
router.put('/players/:discordUserId', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const User = require('../models/User');
        const user = await User.findById(req.session.user.id);
        if (!user || user.email !== process.env.ADMIN_EMAIL) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const discordUserId = String(req.params.discordUserId || '').trim();
        if (!discordUserId) {
            return res.status(400).json({ success: false, error: 'Missing discord_user_id' });
        }

        const { roblox_user_id, roblox_username, status } = req.body || {};
        const RobloxVerify = getRobloxVerifyModel();

        // If clearing verification entirely
        if (roblox_user_id === null || roblox_user_id === '') {
            await RobloxVerify.deleteOne({ discord_user_id: discordUserId });
            console.log(`[API-Game] /players/${discordUserId} PUT | CLEARED verify record`);

            // Tell the bot to strip verify/link roles
            const sync = await notifyBotSyncVerify(discordUserId, 'unverified');

            // Invalidate Discord members cache so dashboard refresh is immediate
            discordMembersCache = { data: null, fetchedAt: 0 };

            return res.json({ success: true, cleared: true, bot_sync: sync });
        }

        const parsedRobloxId = Number(roblox_user_id);
        if (!Number.isFinite(parsedRobloxId) || parsedRobloxId <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid roblox_user_id' });
        }

        const normalizedStatus = status === 'unverified' ? 'unverified' : 'verified';

        // Fetch fresh Roblox username from API (best-effort)
        let finalUsername = (roblox_username || '').trim();
        try {
            const rblxRes = await fetch('https://users.roblox.com/v1/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userIds: [parsedRobloxId], excludeBannedUsers: false })
            });
            if (rblxRes.ok) {
                const rblxData = await rblxRes.json();
                const u = (rblxData.data || [])[0];
                if (u && u.name) finalUsername = u.name;
            }
        } catch (err) {
            console.warn('[API-Game] Roblox username lookup failed:', err.message);
        }

        // Need guild_id for upsert — pull from an existing record if available
        const existing = await RobloxVerify.findOne({ discord_user_id: discordUserId }).lean();
        const guildId = existing ? existing.guild_id : (process.env.DISCORD_GUILD_ID || 'unknown');

        await RobloxVerify.updateOne(
            { discord_user_id: discordUserId },
            {
                $set: {
                    roblox_user_id: parsedRobloxId,
                    roblox_username: finalUsername || null,
                    status: normalizedStatus,
                    verified_at: existing ? existing.verified_at : new Date(),
                    guild_id: guildId
                }
            },
            { upsert: true }
        );

        console.log(`[API-Game] /players/${discordUserId} PUT | roblox:${parsedRobloxId} (${finalUsername}) status:${normalizedStatus}`);

        // Tell the bot to apply/remove Discord roles to match the new state
        const sync = await notifyBotSyncVerify(discordUserId, normalizedStatus);

        // Invalidate Discord members cache so dashboard refresh is immediate
        discordMembersCache = { data: null, fetchedAt: 0 };

        res.json({
            success: true,
            data: {
                discord_user_id: discordUserId,
                roblox_user_id: parsedRobloxId,
                roblox_username: finalUsername || null,
                status: normalizedStatus
            },
            bot_sync: sync
        });
    } catch (error) {
        console.error('[API-Game] /players/:id PUT ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// POST /api/game/players/:discordUserId/moderation
// Forwards moderation actions to the Discord bot
// body: { action: 'warn' | 'unwarn' | 'ban' | 'unban', level?: 1|2, reason?: string }
router.post('/players/:discordUserId/moderation', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        const User = require('../models/User');
        const user = await User.findById(req.session.user.id);
        if (!user || user.email !== process.env.ADMIN_EMAIL) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const discordUserId = String(req.params.discordUserId || '').trim();
        if (!discordUserId) {
            return res.status(400).json({ success: false, error: 'Missing discord_user_id' });
        }

        const { action, level, reason } = req.body || {};
        const botApiUrl = process.env.BOT_API_URL;
        const botApiSecret = process.env.BOT_API_SECRET;
        if (!botApiUrl || !botApiSecret) {
            return res.status(500).json({ success: false, error: 'Bot API not configured' });
        }

        let endpoint = null;
        const payload = {
            discord_user_id: discordUserId,
            reason: String(reason || ''),
            actor: user.username || user.email || 'dashboard',
            secret: botApiSecret
        };

        if (action === 'warn') {
            const lvl = Number(level);
            if (![1, 2].includes(lvl)) {
                return res.status(400).json({ success: false, error: 'Invalid warn level (must be 1 or 2)' });
            }
            payload.level = lvl;
            endpoint = '/moderation/warn';
        } else if (action === 'unwarn') {
            endpoint = '/moderation/unwarn';
        } else if (action === 'ban') {
            endpoint = '/moderation/ban';
        } else if (action === 'unban') {
            endpoint = '/moderation/unban';
        } else {
            return res.status(400).json({ success: false, error: 'Invalid action' });
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const botRes = await fetch(`${botApiUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await botRes.json().catch(() => ({}));
            if (!botRes.ok || !data.success) {
                console.warn(`[API-Game] Moderation ${action} failed:`, data.error || botRes.status);
                return res.status(botRes.status || 500).json({
                    success: false,
                    error: data.error || `Bot responded with ${botRes.status}`
                });
            }

            console.log(`[API-Game] Moderation ${action} OK | ${discordUserId}${level ? ' level ' + level : ''} by ${payload.actor}`);

            // Invalidate cache so dashboard refresh is immediate
            discordMembersCache = { data: null, fetchedAt: 0 };

            res.json({ success: true, action, data });
        } catch (err) {
            console.error('[API-Game] Moderation forward error:', err);
            res.status(500).json({ success: false, error: err.message || 'Failed to reach bot' });
        }
    } catch (error) {
        console.error('[API-Game] /moderation ERROR:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
