const mongoose = require('mongoose');

// OTP Schema
const otpSchema = new mongoose.Schema({
    userId:{
        type: String,
        unique: true,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    otp: {
        type: String,
        required: true
    },
    purpose: {
        type: String,
        enum: ['phone_verification', 'transaction_auth', 'password_reset'],
        required: true
    },
    verified: {
        type: Boolean,
        default: false
    },
    attempts: {
        type: Number,
        default: 0,
        max: 3
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    }
}, {timestamps: true});

module.exports = mongoose.model('Otp', otpSchema);

// Auto-delete expired sessions and OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });