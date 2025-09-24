const { required } = require('joi');
const mongoose = require('mongoose');

// SMS Session Schema - Track ongoing conversations
const smsSessionSchema = new mongoose.Schema({
    userId:{
        type: String,
        unique: true,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    sessionId: {
        type: String,
        unique: true,
        required: true
    },
    currentStep: {
        type: String,
        enum: ['awaiting_command', 'awaiting_amount', 'awaiting_recipient', 'awaiting_pin', 'awaiting_confirmation', 'awaiting_ussd_pin'],
        required: true,
        default: 'awaiting_command'
    },
    transactionData: {
        // amount: Number,
        // recipient: String,
        // recipientName: String,
        // description: String
        type: mongoose.Schema.Types.Mixed
    },
    lastActivity: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    }
},{timestamps: true});

module.exports = mongoose.model('smsSession', smsSessionSchema);

// Auto-delete expired sessions and OTPs
smsSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });