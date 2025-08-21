const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
    provider: {
        type: String,
        required: true // 'paystack', 'korapay', 'africastalking', 'mono' etc.
    },
    eventType: String,
    eventData: Object,
    transactionId: String,
    processed: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
},{timestamps: true});

module.exports = mongoose.model('webhookEvent', webhookEventSchema);