require('dotenv').config();
const mongoose = require('mongoose');

const WEBSITE_URI = process.env.WEBSITE_MONGO_URI;
const DISCORD_URI = process.env.DISCORD_MONGO_URI;

if (!WEBSITE_URI || !DISCORD_URI) {
    console.error('Missing WEBSITE_MONGO_URI or DISCORD_MONGO_URI in .env');
    process.exit(1);
}

async function migrate() {
    const websiteConn = await mongoose.createConnection(WEBSITE_URI).asPromise();
    const discordConn = await mongoose.createConnection(DISCORD_URI).asPromise();

    console.log('Connected to both databases');

    const websiteCollection = websiteConn.db.collection('robloxverifies');
    const discordCollection = discordConn.db.collection('roblox_verify');

    const docs = await websiteCollection.find({}).toArray();
    console.log(`Found ${docs.length} documents in website.robloxverifies`);

    if (docs.length === 0) {
        const altCollection = websiteConn.db.collection('roblox_verify');
        const altDocs = await altCollection.find({}).toArray();
        console.log(`Found ${altDocs.length} documents in website.roblox_verify`);

        if (altDocs.length > 0) {
            docs.push(...altDocs);
        }
    }

    if (docs.length === 0) {
        console.log('No documents to migrate');
        await websiteConn.close();
        await discordConn.close();
        return;
    }

    let migrated = 0;
    let skipped = 0;

    for (const doc of docs) {
        try {
            const { _id, ...data } = doc;
            await discordCollection.updateOne(
                { discord_user_id: data.discord_user_id },
                { $set: data },
                { upsert: true }
            );
            migrated++;
            console.log(`  Migrated: discord_user_id=${data.discord_user_id}, roblox_user_id=${data.roblox_user_id}`);
        } catch (err) {
            skipped++;
            console.error(`  Skipped: discord_user_id=${doc.discord_user_id} - ${err.message}`);
        }
    }

    console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);

    await websiteConn.close();
    await discordConn.close();
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
