const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const { getRobloxVerifyModel } = require('../models/RobloxVerify');
const router = express.Router();

const BOT_API_URL = process.env.BOT_API_URL || '';
const BOT_API_SECRET = process.env.BOT_API_SECRET || '';

const DISCORD_API = 'https://discord.com/api/v10';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;

function generateToken(length = 15) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
        token += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return token;
}

async function generateUniqueToken() {
    let token;
    let isUnique = false;
    while (!isUnique) {
        token = generateToken(15);
        const existing = await User.findOne({ token });
        if (!existing) isUnique = true;
    }
    return token;
}

// Redirect to Discord OAuth2
router.get('/', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauth_state = state;

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'identify email guilds guilds.join connections relationships.read activities.read',
        state: state
    });

    req.session.save((err) => {
        if (err) {
            console.error('Failed to save session before OAuth redirect:', err);
            return res.redirect('/login?error=oauth_failed');
        }
        console.log('[OAuth Start] session ID:', req.sessionID, 'state:', state);
        res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
    });
});

// Discord OAuth2 callback
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;

    console.log('[OAuth Callback] state from query:', state);
    console.log('[OAuth Callback] state from session:', req.session.oauth_state);
    console.log('[OAuth Callback] session ID:', req.sessionID);

    if (!code || !state || state !== req.session.oauth_state) {
        console.error('[OAuth Callback] State mismatch! query:', state, 'session:', req.session.oauth_state);
        return res.redirect('/login?error=invalid_state');
    }

    delete req.session.oauth_state;

    try {
        // Exchange code for access token
        const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI
            })
        });

        if (!tokenRes.ok) {
            console.error('Discord token exchange failed:', await tokenRes.text());
            return res.redirect('/login?error=token_failed');
        }

        const tokenData = await tokenRes.json();

        // Get Discord user info
        const userRes = await fetch(`${DISCORD_API}/users/@me`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        if (!userRes.ok) {
            console.error('Discord user fetch failed:', await userRes.text());
            return res.redirect('/login?error=user_failed');
        }

        const discordUser = await userRes.json();

        // Find or create user
        let user = await User.findOne({ discord_user_id: discordUser.id });

        if (!user) {
            const userToken = await generateUniqueToken();

            user = new User({
                username: discordUser.username,
                email: discordUser.email || `${discordUser.id}@discord.user`,
                discord_user_id: discordUser.id,
                token: userToken,
                website_linked_at: new Date()
            });

            await user.save();
            console.log(`New user registered via Discord: ${discordUser.username} (${discordUser.id})`);
        } else {
            if (discordUser.email) user.email = discordUser.email;
            if (!user.website_linked_at) user.website_linked_at = new Date();
            user.updated_at = Date.now();
            await user.save();
        }

        // Auto-link Roblox account if verified in Discord
        if (!user.roblox_user_id) {
            try {
                const robloxVerify = await getRobloxVerifyModel().findOne({
                    discord_user_id: discordUser.id,
                    status: 'verified'
                }).lean();

                if (robloxVerify) {
                    user.roblox_user_id = robloxVerify.roblox_user_id;
                    await user.save();
                    console.log(`Auto-linked Roblox ${robloxVerify.roblox_user_id} to ${discordUser.username}`);
                }
            } catch (err) {
                console.error('Error auto-linking Roblox:', err);
            }
        }

        // Assign LINK role if both Roblox and Website are verified
        if (BOT_API_URL && BOT_API_SECRET) {
            try {
                const robloxVerify = await getRobloxVerifyModel().findOne({
                    discord_user_id: discordUser.id,
                    status: 'verified'
                }).lean();

                if (robloxVerify) {
                    await fetch(`${BOT_API_URL}/assign-link-role`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            discord_user_id: discordUser.id,
                            secret: BOT_API_SECRET
                        })
                    }).catch(err => console.error('[Discord Auth] Failed to assign link role:', err));
                }
            } catch (err) {
                console.error('[Discord Auth] Error checking link role:', err);
            }
        }

        // Set session
        req.session.user = {
            id: user._id,
            username: user.username,
            email: user.email,
            discord_user_id: user.discord_user_id
        };

        console.log(`User logged in via Discord: ${user.username} (${discordUser.id})`);
        res.redirect('/');

    } catch (error) {
        console.error('Discord OAuth error:', error);
        res.redirect('/login?error=oauth_failed');
    }
});

module.exports = router;
