const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
    userid: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "user id is required"],
        unique: true // one KYC record per user
    },
    idType: {
        type: String,
        enum: ['bvn', 'nin', 'passport'],
        required: [true, "ID type is required"]
    },
    idNumber: {
        type: String,
        required: [true, 'encrypted id number is required']
    },
    // Verification details
    verificationProvider: {
        type: String,
        default: 'mono'
    },
    verificationDate: {
        type: Date,
        default: Date.now
    },
    verificationStatus: {
        type: String,
        enum: ['verified', 'pending', 'failed'],
        default: 'verified'
    }
}, { timestamps: true });

// Index for faster lookups
// kycSchema.index({ userid: 1 });

module.exports = mongoose.model("KYC", kycSchema);