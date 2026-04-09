const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');

router.get('/', (req, res) => {
    const success = req.query.registered ? 'Account created successfully. Please sign in.' : null;
    res.render('login', { error: null, success, user: req.session.user });
});

router.post('/', async (req, res) => {
    const { identifier, password } = req.body;
    const isJSON = req.is('application/json');

    try {
        const user = await User.findOne({
            $or: [
                { username: identifier },
                { email: identifier.toLowerCase() }
            ]
        });

        if (!user) {
            if (isJSON) return res.status(401).json({ error: 'Invalid username/email or password' });
            return res.render('login', { error: 'Invalid username/email or password', success: null, user: null });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            if (isJSON) return res.status(401).json({ error: 'Invalid username/email or password' });
            return res.render('login', { error: 'Invalid username/email or password', success: null, user: null });
        }

        req.session.user = {
            id: user._id,
            username: user.username,
            email: user.email
        };

        console.log(`User logged in: ${user.username}`);

        if (isJSON) return res.status(200).json({ success: true, redirect: '/' });
        return res.redirect('/');

    } catch (error) {
        console.error('Login error:', error);
        if (isJSON) return res.status(500).json({ error: 'Login failed. Please try again.' });
        return res.render('login', { error: 'Login failed. Please try again.', success: null, user: null });
    }
});

module.exports = router;
