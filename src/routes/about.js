const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
    res.render('about', {
        user: req.session.user,
        socials: {
            discord: process.env.DISCORD || '',
            youtube: process.env.YOUTUBE || '',
            tiktok: process.env.TIKTOK || '',
            instagram: process.env.INSTAGRAM || '',
            facebook: process.env.FACEBOOK || ''
        }
    });
});

module.exports = router;