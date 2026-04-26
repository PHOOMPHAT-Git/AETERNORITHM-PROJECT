const mongoose = require('mongoose');

// Secondary connection to Discord database (shared models like RobloxVerify)
let discordConnection = null;

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.WEBSITE_MONGO_URI);
        console.log('MongoDB Connected Successfully');

        if (process.env.DISCORD_MONGO_URI) {
            discordConnection = await mongoose.createConnection(process.env.DISCORD_MONGO_URI).asPromise();
            console.log('Discord MongoDB Connected Successfully');
        }

        try {
            const Creator = require('../models/Creator');
            const seed = require('../data/creators');
            const count = await Creator.countDocuments();
            if (count === 0 && Array.isArray(seed) && seed.length > 0) {
                const docs = seed.map((c, i) => ({
                    name: c.name,
                    handle: c.handle,
                    platform: c.platform,
                    url: c.url,
                    avatar: c.avatar || '',
                    banner: c.banner || '',
                    followers: c.followers || '',
                    order: i
                }));
                await Creator.insertMany(docs);
                console.log(`Seeded ${docs.length} creators`);
            }
        } catch (seedErr) {
            console.error('Creator seed error:', seedErr.message);
        }
    } catch (error) {
        console.error('MongoDB Connection Error:', error.message);
        process.exit(1);
    }
};

const getDiscordConnection = () => discordConnection;

module.exports = { connectDB, getDiscordConnection };