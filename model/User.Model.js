const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        match: /^\+[1-9]\d{1,14}$/ // E.164 format
    },
    // nin: {
    //     type: String,
    //     required: true,
    //     unique: true
    // },
    bvn: {
        type: String,
        required: true,
        unique: true
    },
    fullName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    isPhoneVerified: {
        type: Boolean,
        default: false
    },
    isKYCVerified: {
        type: Boolean,
        default: false
    },
    pin: {
        type: String,
        required: true // Hashed 4-6 digit PIN
    },
    walletBalance: {
        type: Number,
        default: 0.00,
        min: 0
    },
    bankAccounts: [{
        bankCode: String,
        accountNumber: String,
        accountName: String,
        isDefault: Boolean
    }],
    deviceInfo: {
        imei: String,
        lastLoginIP: String,
        simSwapDetected: {
        type: Boolean,
        default: false
        }
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'blocked'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {timestamps: true});

module.exports = mongoose.model('User', UserSchema)