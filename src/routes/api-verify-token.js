const express = require('express');
const router = express.Router();
const User = require('../models/User');

const BOT_API_SECRET = process.env.BOT_API_SECRET || '';

router.post('/', async (req, res) => {
    try {
        const { token, discord_user_id, discord_username, secret } = req.body;

        if (secret !== BOT_API_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!token || !discord_user_id) {
            return res.status(400).json({
                message: 'Missing required fields.',
                messageTH: 'ข้อมูลไม่ครบถ้วน'
            });
        }

        // Check if this Discord account is already linked to another website account
        const existingLink = await User.findOne({ discord_user_id });
        if (existingLink) {
            return res.status(400).json({
                message: `This Discord account is already linked to website account : ${existingLink.username}`,
                messageTH: `บัญชี Discord นี้เชื่อมต่อกับบัญชีเว็บไซต์แล้ว : ${existingLink.username}`
            });
        }

        // Find user by token
        const user = await User.findOne({ token });
        if (!user) {
            return res.status(400).json({
                message: 'Invalid token. Please check your token from the website profile page.',
                messageTH: 'Token ไม่ถูกต้อง กรุณาตรวจสอบ Token จากหน้าโปรไฟล์บนเว็บไซต์'
            });
        }

        // Check if this website account is already linked to another Discord account
        if (user.discord_user_id && user.discord_user_id !== discord_user_id) {
            return res.status(400).json({
                message: 'This website account is already linked to another Discord account.',
                messageTH: 'บัญชีเว็บไซต์นี้เชื่อมต่อกับบัญชี Discord อื่นแล้ว'
            });
        }

        // Link Discord account to website account
        user.discord_user_id = discord_user_id;
        user.website_linked_at = new Date();
        user.updated_at = Date.now();
        await user.save();

        console.log(`[Website Verify] Discord ${discord_user_id} (${discord_username}) linked to website account: ${user.username}`);

        res.json({
            success: true,
            username: user.username,
            message: 'Successfully linked Discord to website account.',
            messageTH: 'เชื่อมต่อบัญชี Discord กับเว็บไซต์สำเร็จ'
        });

    } catch (error) {
        console.error('[API Verify Token] Error:', error);
        res.status(500).json({
            message: 'An error occurred. Please try again.',
            messageTH: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
        });
    }
});

module.exports = router;
