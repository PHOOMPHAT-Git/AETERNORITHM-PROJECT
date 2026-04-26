const mongoose = require('mongoose');

const ServiceStatusSchema = new mongoose.Schema({
    serviceName: {
        type: String,
        required: true,
        unique: true,
        enum: ['discord-bot', 'website']
    },
    status: {
        type: String,
        required: true,
        enum: ['online', 'offline', 'maintenance', 'degraded'],
        default: 'offline'
    },
    lastHeartbeat: {
        type: Date,
        default: Date.now
    },
    details: {
        version: { type: String, default: '' },
        uptime: { type: Number, default: 0 },
        message: { type: String, default: '' }
    },
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

module.exports = mongoose.models.ServiceStatus || mongoose.model('ServiceStatus', ServiceStatusSchema, 'service_status');
