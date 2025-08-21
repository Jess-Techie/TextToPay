const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// Controllers
const { loginUser, getUserProfile } = require('../controller/userController');
const { processSMSCommand } = require('../controller/enhancedSmsController');
const { getAirtimeHistory } = require('../controller/airtimeController');
const TransactionModel = require('../model/Transaction.Model');
const UserModel = require('../model/User.Model');

// Utils
// const { 
// //   sendSMS, 
//   generateOTP, 
//   normalizeNigerianPhone,
//   generateRateLimitKey 
// } = require('../utils/smsUtils');
const { verifyWebhookSignature } = require('../utils/korapayUtils');
const { sendSMS } = require('../controller/bankAndSmsUtil.Contrl');

const router = express.Router();

// Rate limiting configurations
const smsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 SMS per minute per phone
  keyGenerator: (req) => generateRateLimitKey(req.body.from || req.body.phoneNumber, 'sms'),
  message: { error: 'Too many SMS requests. Please wait.' }
});

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  message: { error: 'Too many authentication attempts. Try again later.' }
});

const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 webhook calls per minute
  message: { error: 'Webhook rate limit exceeded' }
});

// Middleware to verify JWT tokens
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// ==================== HEALTH CHECK ====================
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'TextToPay API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ==================== SMS WEBHOOK ROUTES ====================

// Handle incoming SMS from Africa's Talking
router.post('/sms/webhook', smsRateLimit, async (req, res) => {
  try {
    const { from, to, text, date, id, networkCode } = req.body;
    
    console.log(`📱 Incoming SMS from ${from}: ${text}`);
    
    // Log the SMS interaction
    console.log('SMS Webhook Data:', {
      from,
      to,
      text: text.substring(0, 50) + '...',
      date,
      id,
      networkCode
    });
    
    // Process the SMS command asynchronously
    processSMSCommand(from, text).catch(error => {
      console.error('Async SMS processing error:', error);
    });
    
    // Respond immediately to Africa's Talking
    res.status(200).json({ 
      success: true,
      message: 'SMS received and processing'
    });
    
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.status(500).json({ 
      success: false,
      error: 'SMS processing failed' 
    });
  }
});

// ==================== AUTHENTICATION ROUTES ====================

// User login (for web/mobile app)
router.post('/auth/login', authRateLimit, loginUser);

// Get user profile
router.get('/auth/profile', authenticateToken, getUserProfile);

// Send OTP (for password reset, etc.)
router.post('/auth/send-otp', authRateLimit, async (req, res) => {
  try {
    const { phoneNumber, purpose = 'verification' } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    
    const normalizedPhone = normalizeNigerianPhone(phoneNumber);
    const otp = generateOTP();
    
    // Store OTP in database (implement OTP model)
    // await OtpModel.create({ phoneNumber: normalizedPhone, otp, purpose });
    
    const message = `Your TextToPay verification code is: ${otp}\nValid for 5 minutes.`;
    await sendSMS(normalizedPhone, message);
    
    res.json({
      success: true,
      message: 'OTP sent successfully'
    });
    
  } catch (error) {
    console.error('OTP send error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// ==================== TRANSACTION ROUTES ====================

// Get transaction history
router.get('/transactions/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query;
    const userId = req.user.userId;
    
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Build query
    const query = {
      $or: [
        { senderPhone: user.phoneNumber },
        { recipientPhone: user.phoneNumber }
      ]
    };
    
    if (type) query.paymentMethod = type;
    if (status) query.status = status;
    
    const transactions = await TransactionModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await TransactionModel.countDocuments(query);
    
    res.json({
      success: true,
      transactions: transactions.map(txn => ({
        id: txn.transactionId,
        amount: txn.amount,
        fees: txn.fees,
        recipient: txn.recipientName,
        recipientPhone: txn.recipientPhone,
        description: txn.description,
        status: txn.status,
        type: txn.senderPhone === user.phoneNumber ? 'sent' : 'received',
        method: txn.paymentMethod,
        createdAt: txn.createdAt,
        completedAt: txn.completedAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: Math.ceil(total / limit),
        count: transactions.length,
        totalRecords: total
      }
    });
    
  } catch (error) {
    console.error('Transaction history error:', error);
    res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

// Get single transaction details
router.get('/transactions/:transactionId', authenticateToken, async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.userId;
    
    const user = await UserModel.findById(userId);
    const transaction = await TransactionModel.findOne({
      transactionId,
      $or: [
        { senderPhone: user.phoneNumber },
        { recipientPhone: user.phoneNumber }
      ]
    });
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    res.json({
      success: true,
      transaction: {
        id: transaction.transactionId,
        amount: transaction.amount,
        fees: transaction.fees,
        recipient: transaction.recipientName,
        recipientPhone: transaction.recipientPhone,
        description: transaction.description,
        status: transaction.status,
        paymentMethod: transaction.paymentMethod,
        type: transaction.senderPhone === user.phoneNumber ? 'sent' : 'received',
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
        metadata: transaction.metadata
      }
    });
    
  } catch (error) {
    console.error('Transaction details error:', error);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
});

// ==================== WALLET ROUTES ====================

// Get wallet balance and details
router.get('/wallet/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await UserModel.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get transaction summary
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const [totalSent, totalReceived, transactionCount] = await Promise.all([
      TransactionModel.aggregate([
        {
          $match: {
            senderPhone: user.phoneNumber,
            status: 'completed',
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      TransactionModel.aggregate([
        {
          $match: {
            recipientPhone: user.phoneNumber,
            status: 'completed',
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      TransactionModel.countDocuments({
        $or: [
          { senderPhone: user.phoneNumber },
          { recipientPhone: user.phoneNumber }
        ],
        createdAt: { $gte: thirtyDaysAgo }
      })
    ]);
    
    res.json({
      success: true,
      wallet: {
        balance: user.walletBalance,
        virtualAccount: user.virtualAccount || null,
        statistics: {
          totalSent: totalSent[0]?.total || 0,
          totalReceived: totalReceived[0]?.total || 0,
          transactionCount,
          period: '30 days'
        }
      },
      user: {
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        isVerified: user.isPhoneVerified && user.bvnVerified
      }
    });
    
  } catch (error) {
    console.error('Wallet balance error:', error);
    res.status(500).json({ error: 'Failed to fetch wallet balance' });
  }
});

// ==================== AIRTIME ROUTES ====================

// Get airtime purchase history
router.get('/airtime/history', authenticateToken, getAirtimeHistory);

// ==================== BANK ROUTES ====================

// Get list of Nigerian banks
router.get('/banks/list', async (req, res) => {
  try {
    const { getNigerianBanks } = require('../utils/korapayUtils');
    const result = await getNigerianBanks();
    
    res.json({
      success: result.success,
      banks: result.data
    });
    
  } catch (error) {
    console.error('Banks list error:', error);
    res.status(500).json({ error: 'Failed to fetch banks list' });
  }
});

// Resolve bank account name
router.post('/banks/resolve', async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;
    
    if (!accountNumber || !bankCode) {
      return res.status(400).json({ 
        error: 'Account number and bank code are required' 
      });
    }
    
    const { resolveAccountName } = require('../utils/korapayUtils');
    const result = await resolveAccountName(accountNumber, bankCode);
    
    res.json(result);
    
  } catch (error) {
    console.error('Account resolution error:', error);
    res.status(500).json({ error: 'Account resolution failed' });
  }
});

// ==================== WEBHOOK ROUTES ====================

// Korapay webhook handler
router.post('/webhooks/korapay', webhookRateLimit, async (req, res) => {
  try {
    const signature = req.headers['x-korapay-signature'];
    const payload = req.body;
    
    // Verify webhook signature
    if (!verifyWebhookSignature(payload, signature)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    
    console.log('Korapay webhook received:', payload.event);
    
    // Handle different webhook events
    switch (payload.event) {
      case 'charge.success':
        await handleChargeSuccess(payload.data);
        break;
        
      case 'transfer.success':
        await handleTransferSuccess(payload.data);
        break;
        
      case 'transfer.failed':
        await handleTransferFailed(payload.data);
        break;
        
      default:
        console.log('Unhandled webhook event:', payload.event);
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('Korapay webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle successful charge (wallet funding)
const handleChargeSuccess = async (data) => {
  try {
    const { reference, amount, customer } = data;
    
    // Find user by reference or customer data
    const user = await UserModel.findOne({
      $or: [
        { phoneNumber: customer.phone },
        { email: customer.email }
      ]
    });
    
    if (user) {
      const fundAmount = amount / 100; // Convert from kobo
      
      await UserModel.updateOne(
        { _id: user._id },
        { $inc: { walletBalance: fundAmount } }
      );
      
      // Send SMS notification
      await sendSMS(user.phoneNumber, 
        ` Wallet Funded Successfully!
        
            ₦${fundAmount.toFixed(2)} added to your wallet
            💳 Balance: ₦${(user.walletBalance + fundAmount).toFixed(2)}

            Ready to send money! 🚀`);
      
      console.log(`Wallet funded: ${user.phoneNumber} - ₦${fundAmount}`);
    }
    
  } catch (error) {
    console.error('Charge success handler error:', error);
  }
};

// Handle successful transfer
const handleTransferSuccess = async (data) => {
  try {
    const { reference } = data;
    
    await TransactionModel.updateOne(
      { transactionId: reference },
      { 
        status: 'completed',
        completedAt: new Date()
      }
    );
    
    console.log(`Transfer completed: ${reference}`);
    
  } catch (error) {
    console.error('Transfer success handler error:', error);
  }
};

// Handle failed transfer
const handleTransferFailed = async (data) => {
  try {
    const { reference, failure_reason } = data;
    
    const transaction = await TransactionModel.findOne({ transactionId: reference });
    
    if (transaction) {
      await TransactionModel.updateOne(
        { transactionId: reference },
        { 
          status: 'failed',
          'metadata.failureReason': failure_reason
        }
      );
      
      // Refund user
      const user = await UserModel.findOne({ phoneNumber: transaction.senderPhone });
      if (user) {
        const refundAmount = transaction.amount + transaction.fees;
        
        await UserModel.updateOne(
          { _id: user._id },
          { $inc: { walletBalance: refundAmount } }
        );
        
        // Notify user
        await sendSMS(user.phoneNumber, 
          `❌ Transfer Failed
          
₦${transaction.amount} to ${transaction.recipientName}
Reason: ${failure_reason}

₦${refundAmount} refunded to your wallet.
Ref: ${reference}`);
      }
    }
    
  } catch (error) {
    console.error('Transfer failed handler error:', error);
  }
};

// ==================== ADMIN ROUTES (Optional) ====================

// Get system statistics (admin only)
router.get('/admin/stats', authenticateToken, async (req, res) => {
  try {
    // Add admin check here
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [
      totalUsers,
      activeUsers,
      todayTransactions,
      totalVolume
    ] = await Promise.all([
      UserModel.countDocuments(),
      UserModel.countDocuments({ 
        isPhoneVerified: true,
        status: 'active' 
      }),
      TransactionModel.countDocuments({
        createdAt: { $gte: today }
      }),
      TransactionModel.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);
    
    res.json({
      success: true,
      statistics: {
        totalUsers,
        activeUsers,
        todayTransactions,
        totalVolume: totalVolume[0]?.total || 0,
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;