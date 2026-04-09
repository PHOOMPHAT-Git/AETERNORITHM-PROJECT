const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        const user = await User.findById(req.session.user.id);
        if (!user || user.email !== process.env.ADMIN_EMAIL) {
            return res.status(403).render('error', {
                statusCode: 403,
                title: 'Access Denied',
                message: 'You do not have permission to access this page.'
            });
        }

        res.render('dashboard', { user });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).send('An error occurred');
    }
});

module.exports = router;
