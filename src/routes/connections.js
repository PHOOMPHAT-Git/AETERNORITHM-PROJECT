const express = require('express');
const router = express.Router();
const Creator = require('../models/Creator');

router.get('/', async (req, res) => {
    let creators = [];
    try {
        creators = await Creator.find({}).sort({ subscribers: -1, order: 1, created_at: 1 }).lean();
    } catch (err) {
        console.error('[Connections] Failed to load creators:', err.message);
    }
    res.render('connections', {
        user: req.session.user,
        creators
    });
});

module.exports = router;
