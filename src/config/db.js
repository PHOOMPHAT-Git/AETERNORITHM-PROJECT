const mongoose = require('mongoose');

// Secondary connection to Discord database (shared models like RobloxVerify)
let discordConnection = null;

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.WEBSITE_MONGO_URI);
        console.log('MongoDB Connected Successfully');

        // Connect to Discord database for shared models
        if (process.env.DISCORD_MONGO_URI) {
            discordConnection = await mongoose.createConnection(process.env.DISCORD_MONGO_URI).asPromise();
            console.log('Discord MongoDB Connected Successfully');
        }
    } catch (error) {
        console.error('MongoDB Connection Error:', error.message);
        process.exit(1);
    }
};

const getDiscordConnection = () => discordConnection;

module.exports = { connectDB, getDiscordConnection };