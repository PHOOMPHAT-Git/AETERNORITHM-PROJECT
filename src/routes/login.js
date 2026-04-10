const express = require('express');
const router = express.Router();

const ERROR_MESSAGES = {
    invalid_state: 'Authentication failed. Please try again.',
    token_failed: 'Could not connect to Discord. Please try again.',
    user_failed: 'Could not get Discord account info. Please try again.',
    oauth_failed: 'Login failed. Please try again.'
};

router.get('/', (req, res) => {
    const errorKey = req.query.error;
    const error = ERROR_MESSAGES[errorKey] || null;
    res.render('login', { error, user: req.session.user });
});

module.exports = router;
