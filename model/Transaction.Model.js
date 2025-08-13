const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
    userId:{
        type: String,
        unique: true,
        required: true
    },
    transactionId: {
        type: String,
        unique: true,
        required: true
  },
    senderPhone: {
        type: String,
        required: true
    },
    recipientPhone: {
        type: String,
        required: true
    },
    recipientName: String, // From name resolution
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
        enum: ['initiated', 'pending', 'confirmed', 'processing', 'completed', 'failed', 'cancelled'],
        default: 'initiated'
    },
    paymentMethod: {
        type: String,
        enum: ['wallet', 'bank_transfer', 'ussd'],
        required: true
    },
    bankCode: String, // If bank transfer
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
        location: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date
}, {timestamps: true});

module.exports = mongoose.model('Transaction', TransactionSchema);
