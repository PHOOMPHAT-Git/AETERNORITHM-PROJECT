const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const router = express.Router();

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
        scope: 'identify email',
        state: state
    });

    res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
});

// Discord OAuth2 callback
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code || !state || state !== req.session.oauth_state) {
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
                discord_avatar: discordUser.avatar,
                discord_global_name: discordUser.global_name || discordUser.username,
                token: userToken
            });

            await user.save();
            console.log(`New user registered via Discord: ${discordUser.username} (${discordUser.id})`);
        } else {
            // Update Discord info on each login
            user.discord_avatar = discordUser.avatar;
            user.discord_global_name = discordUser.global_name || discordUser.username;
            if (discordUser.email) user.email = discordUser.email;
            user.updated_at = Date.now();
            await user.save();
        }

        // Set session
        req.session.user = {
            id: user._id,
            username: user.username,
            email: user.email,
            discord_user_id: user.discord_user_id,
            discord_avatar: user.discord_avatar,
            discord_global_name: user.discord_global_name
        };

        console.log(`User logged in via Discord: ${user.username} (${discordUser.id})`);
        res.redirect('/');

    } catch (error) {
        console.error('Discord OAuth error:', error);
        res.redirect('/login?error=oauth_failed');
    }
});

module.exports = router;
