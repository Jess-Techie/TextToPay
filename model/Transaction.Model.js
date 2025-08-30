const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    transactionId: {
        type: String,
        unique: true,   // ✅ unique index only here
        required: true
    },
    senderUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    senderVirtualAccount: {
        accountNumber: String,
        accountName: String
    },
    recipientUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    recipientVirtualAccount: {
        accountNumber: String,
        accountName: String
    },
    // For external bank transfers
    recipientBankDetails: {
        accountNumber: String,
        accountName: String,
        bankName: String,
        bankCode: String
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    description: String,
    currency: {
        type: String,
        default: 'NGN'
    },
    status: {
        type: String,
        enum: [
            'initiated',
            'pending',
            'confirmed',
            'processing',
            'completed',
            'failed',
            'cancelled'
        ],
        default: 'initiated'
    },
    transferType: {
        type: String,
        enum: ['internal', 'bank_transfer', 'airtime', 'data'], // Add these
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['wallet', 'bank_transfer', 'ussd', 'airtime_purchase', 'data_purchase'], // Add these
        required: true
     },
    fees: {
        type: Number,
        default: 0
    },
    reference: String, // External payment reference
    smsLogs: [{
        direction: {
            type: String,
            enum: ['inbound', 'outbound']
        },
        message: String,
        status: {
            type: String,
            enum: ['sent', 'delivered', 'failed']
        },
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    metadata: {
        ipAddress: String,
        userAgent: String,
        location: String,
        initiatedVia: {
            type: String,
            enum: ['sms', 'ussd', 'api'],
            default: 'sms'
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date
}, { 
    timestamps: true 
});

// Compound indexes for query optimization
TransactionSchema.index({ senderUserId: 1, createdAt: -1 });
TransactionSchema.index({ recipientUserId: 1, createdAt: -1 });
TransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
