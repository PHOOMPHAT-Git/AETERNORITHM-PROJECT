const express = require('express');
const router = express.Router();
const Creator = require('../models/Creator');
const User = require('../models/User');
const { fetchYouTubeChannel, parseYouTubeUrl, parseFollowersString } = require('../services/youtube');

async function requireAdmin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    try {
        const user = await User.findById(req.session.user.id);
        if (!user || user.email !== process.env.ADMIN_EMAIL) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        req.adminUser = user;
        next();
    } catch (err) {
        console.error('[API-Creators] Admin check error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

const PLATFORMS = ['youtube', 'tiktok'];

function sanitizeUrl(input) {
    const value = String(input || '').trim();
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) return '';
    return value;
}

function buildPayload(body) {
    const platform = String(body.platform || '').toLowerCase().trim();
    if (!PLATFORMS.includes(platform)) {
        return { error: 'Platform must be youtube or tiktok' };
    }
    const name = String(body.name || '').trim();
    const handle = String(body.handle || '').trim();
    const url = sanitizeUrl(body.url);
    if (!name) return { error: 'Name is required' };
    if (!handle) return { error: 'Handle is required' };
    if (!url) return { error: 'URL must be a valid http(s) link' };

    const avatarRaw = String(body.avatar || '').trim();
    const bannerRaw = String(body.banner || '').trim();
    const avatar = avatarRaw && !/^https?:\/\//i.test(avatarRaw) && !avatarRaw.startsWith('/') ? '' : avatarRaw;
    const banner = bannerRaw && !/^https?:\/\//i.test(bannerRaw) && !bannerRaw.startsWith('/') ? '' : bannerRaw;

    let order = Number(body.order);
    if (!Number.isFinite(order)) order = 0;

    const followersText = String(body.followers || '').trim();
    let subscribers = Number(body.subscribers);
    if (!Number.isFinite(subscribers) || subscribers <= 0) {
        subscribers = parseFollowersString(followersText);
    } else {
        subscribers = Math.round(subscribers);
    }

    return {
        data: {
            name,
            handle: handle.startsWith('@') ? handle : '@' + handle,
            platform,
            url,
            avatar,
            banner,
            followers: followersText,
            subscribers,
            order
        }
    };
}

router.get('/', requireAdmin, async (req, res) => {
    try {
        const creators = await Creator.find({}).sort({ subscribers: -1, order: 1, created_at: 1 }).lean();
        res.json({ success: true, creators });
    } catch (err) {
        console.error('[API-Creators] GET error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.get('/fetch', requireAdmin, async (req, res) => {
    const url = sanitizeUrl(req.query.url);
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
    if (!parseYouTubeUrl(url)) {
        return res.status(400).json({ success: false, error: 'Only YouTube channel URLs are supported for auto-fetch' });
    }
    try {
        const data = await fetchYouTubeChannel(url);
        res.json({ success: true, data });
    } catch (err) {
        console.error('[API-Creators] Fetch error:', err.message);
        res.status(502).json({ success: false, error: err.message || 'Failed to fetch channel' });
    }
});

router.post('/', requireAdmin, async (req, res) => {
    try {
        const payload = buildPayload(req.body || {});
        if (payload.error) return res.status(400).json({ success: false, error: payload.error });

        const created = await Creator.create(payload.data);
        res.json({ success: true, creator: created.toObject() });
    } catch (err) {
        console.error('[API-Creators] POST error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const payload = buildPayload(req.body || {});
        if (payload.error) return res.status(400).json({ success: false, error: payload.error });

        const updated = await Creator.findByIdAndUpdate(
            req.params.id,
            { $set: { ...payload.data, updated_at: new Date() } },
            { new: true }
        );
        if (!updated) return res.status(404).json({ success: false, error: 'Creator not found' });
        res.json({ success: true, creator: updated.toObject() });
    } catch (err) {
        console.error('[API-Creators] PUT error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const deleted = await Creator.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ success: false, error: 'Creator not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('[API-Creators] DELETE error:', err);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

module.exports = router;
