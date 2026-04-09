const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { getRobloxVerifyModel } = require('../models/RobloxVerify');

router.get('/', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const user = await User.findById(req.session.user.id);
        if (!user) {
            return res.redirect('/login');
        }

        let robloxUserId = user.roblox_user_id;

        // If User model doesn't have roblox_user_id, try to find it from RobloxVerify via discord_user_id
        if (!robloxUserId && user.discord_user_id) {
            const robloxVerify = await getRobloxVerifyModel().findOne({
                discord_user_id: user.discord_user_id,
                status: 'verified'
            }).lean().catch(() => null);

            if (robloxVerify) {
                robloxUserId = robloxVerify.roblox_user_id;
                // Sync back to User model for future lookups
                await User.findByIdAndUpdate(user._id, { roblox_user_id: robloxUserId }).catch(() => {});
            }
        }

        let robloxInfo = null;

        if (robloxUserId) {
            try {
                const response = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
                if (response.ok) {
                    const data = await response.json();
                    robloxInfo = {
                        user_id: robloxUserId,
                        username: data.name,
                        displayName: data.displayName
                    };
                }
            } catch (err) {
                console.error('Error fetching Roblox user info:', err);
            }
        }

        res.render('account', { user, robloxInfo });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).send('An error occurred');
    }
});

module.exports = router;
