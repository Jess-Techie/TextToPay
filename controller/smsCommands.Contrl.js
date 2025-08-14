const smsSessionModel = require("../model/smsSession.Model");
const UserModel = require("../model/User.Model");
const Transaction = require("../model/Transaction.Model");
const { sendSMS, normalizeNigerianPhone, generateTransactionId } = require("./bankAndSmsUtil.Contl");


//handle sms command processor
const handleNewCommand = async(phoneNumber, message) => {

    const user = await UserModel.findOne({phoneNumber, isPhoneVerified:true});

    if(!user){
        return await sendSMS(phoneNumber, "Welcome! You need to register first. Dial *347*456# to get started");
    }
    const cleanMessage = message.trim().toUpperCase();

    //Balance inquiry
    if(cleanMessage === 'BAL' || cleanMessage === 'BALANCE'){
        return await handleBalanceInduiry(user)
    }

    //help command
    if(cleanMessage === 'HELP' || cleanMessage === 'MENU'){
        return await sendHelpMenu(phoneNumber);
    }

    //  // Pay command - PAY 1000 TO 08123456789 or PAY 1000 TO 1234567890 GTB
    if(cleanMessage.startsWith('PAY')){
        return await handlePayCommand(user, cleanMessage);
    }

    // Transaction status - STATUS TXN123456
    if (cleanMessage.startsWith('STATUS ')) {
        return await handleStatusInquiry(user, cleanMessage);
    }

    // Invalid command
    return await sendSMS(phoneNumber, 
    "Invalid command. Reply HELP for available commands or dial *347*456#");

};

// Process PAY command
const handlePayCommand = async (user, message) => {
    // Parse: PAY 1000 TO 08123456789 [DESC] or PAY 5000 TO 1234567890 GTB [DESC]
    const payRegex = /^PAY\s+(\d+(?:\.\d{2})?)\s+TO\s+(\d{10,11})(?:\s+([A-Z]{3}))?(?:\s+(.+))?$/i;
    const match = message.match(payRegex);
    
    if (!match) {
        return await sendSMS(user.phoneNumber, 
        `Invalid format. Use:
    📱 PAY 1000 TO 08123456789 - Phone transfer
    🏦 PAY 5000 TO 1234567890 GTB - Bank transfer`);
    }

    const [, amount, recipient, bankCode, description = ''] = match;
    const amountNum = parseFloat(amount);
    
    // Validate amount
    if (amountNum < 10 || amountNum > 500000) {
        return await sendSMS(user.phoneNumber, 
        "Amount must be between ₦10 and ₦500,000");
    }

    // Check balance (including fees)
    const fee = calculateTransactionFee(amountNum, bankCode ? 'bank' : 'phone');
    const totalAmount = amountNum + fee;
    
    if (user.walletBalance < totalAmount) {
        return await sendSMS(user.phoneNumber, 
        `Insufficient balance. 
    Required: ₦${totalAmount.toFixed(2)} (₦${fee} fee)
    Your balance: ₦${user.walletBalance.toFixed(2)}`);
    }

    let recipientName = 'Unknown User';
    let transferType = 'phone';
  
    // Determine transfer type and resolve recipient
    if (bankCode) {
        // Bank transfer
        transferType = 'bank';
        const bankInfo = resolveNigerianBank(bankCode);
        
        if (!bankInfo) {
        return await sendSMS(user.phoneNumber, 
            "Invalid bank code. Common codes: GTB, UBA, ACCESS, ZENITH, FCMB");
        }
        
        // TODO: Call NIP name resolution API
        recipientName = `${recipient} - ${bankInfo.name}`;
        
    } else {
        // Phone number transfer
        const normalizedPhone = normalizeNigerianPhone(recipient);
        const recipientUser = await UserModel.findOne({ phoneNumber: normalizedPhone });
        
        if (recipientUser) {
        recipientName = recipientUser.fullName;
        } else {
        return await sendSMS(user.phoneNumber, 
            "Recipient not found. They need to register first or use bank transfer format.");
        }
    }

     // Create SMS session for confirmation
    const sessionId = `SMS_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await smsSessionModel.create({
        phoneNumber: user.phoneNumber,
        sessionId,
        currentStep: 'awaiting_confirmation',
        transactionData: {
        amount: amountNum,
        recipient,
        recipientName,
        description: description.trim(),
        transferType,
        bankCode,
        fee
        }
    });

    const confirmMessage = `Confirm payment:
        Send ₦${amountNum.toFixed(2)} to 
        ${recipientName}
        ${description ? `📝 For: ${description}\n` : ''} Fee: ₦${fee.toFixed(2)}
        Total: ₦${totalAmount.toFixed(2)}

        Reply YES to confirm or NO to cancel`;
    
    return await sendSMS(user.phoneNumber, confirmMessage);
}

// Handle confirmation step
const handleConfirmation = async (session, message) => {
    const cleanMessage = message.trim().toUpperCase();
    
    if (cleanMessage === 'NO' || cleanMessage === 'CANCEL') {
        await SMSSession.deleteOne({ _id: session._id });
        return await sendSMS(session.phoneNumber, "Payment cancelled.");
    }
    
    if (cleanMessage !== 'YES' && cleanMessage !== 'CONFIRM') {
        return await sendSMS(session.phoneNumber, 
        "Reply YES to confirm payment or NO to cancel");
    }
    
    // Update session to await PIN
    await smsSessionModel.updateOne(
        { _id: session._id },
        { currentStep: 'awaiting_pin' }
    );
    
    return await sendSMS(session.phoneNumber, 
        "Enter your 4-digit transaction PIN:");
};

// Handle PIN input
const handlePinInput = async (session, message) => {
    const pin = message.trim();
    
    if (!/^\d{4}$/.test(pin)) {
        return await sendSMS(session.phoneNumber, 
        "Invalid PIN format. Enter your 4-digit transaction PIN:");
    }
    
    const user = await UserModel.findOne({ phoneNumber: session.phoneNumber });
    const isValidPin = await bcrypt.compare(pin, user.pin);
    
    if (!isValidPin) {
        // Increment failed attempts
        await smsSessionModel.updateOne(
        { _id: session._id },
        { $inc: { 'transactionData.pinAttempts': 1 } }
        );
        
        if (session.transactionData.pinAttempts >= 2) {
        await smsSessionModel.deleteOne({ _id: session._id });
        return await sendSMS(session.phoneNumber, 
            "Too many failed attempts. Transaction cancelled for security.");
        }
        
        return await sendSMS(session.phoneNumber, 
        "Incorrect PIN. Try again:");
    }
    // Process the transaction
  return await processTransaction(user, session);
};

// Process the actual transaction
const processTransaction = async (user, session) => {
    const { amount, recipient, recipientName, description, transferType, bankCode, fee } = session.transactionData;
    const totalAmount = amount + fee;
    
    // Final balance check
    const currentUser = await UserModel.findById(user._id);
    if (currentUser.walletBalance < totalAmount) {
        await smsSessionModel.deleteOne({ _id: session._id });
        return await sendSMS(user.phoneNumber, 
        "Insufficient balance. Transaction cancelled.");
    }
    
    const transactionId = generateTransactionId();
    
    try {
        // Create transaction record
        const transaction = await Transaction.create({
        transactionId,
        senderPhone: user.phoneNumber,
        recipientPhone: transferType === 'phone' ? normalizeNigerianPhone(recipient) : null,
        recipientName,
        amount,
        fees: fee,
        description,
        status: 'processing',
        paymentMethod: transferType === 'phone' ? 'wallet' : 'bank_transfer',
        bankCode,
        metadata: {
            initiatedVia: 'sms',
            sessionId: session.sessionId
        }
        });
        
        // Deduct from sender's wallet
        await UserModel.updateOne(
        { _id: user._id },
        { $inc: { walletBalance: -totalAmount } }
        );
        
        if (transferType === 'phone') {

            // Internal phone transfer
            const recipientUser = await UserModel.findOne({ 
                phoneNumber: normalizeNigerianPhone(recipient) 
            });
            if (recipientUser) {
                // Credit recipient
                await UserModel.updateOne(
                { _id: recipientUser._id },
                { $inc: { walletBalance: amount } }
                );
                
                await Transaction.updateOne(
                { _id: transaction._id },
                { status: 'completed', completedAt: new Date() }
                );
                
                // Notify both parties
                const newSenderBalance = currentUser.walletBalance - totalAmount;
                
                await sendSMS(user.phoneNumber, 
                    `Payment successful! 
                    ₦${amount.toFixed(2)} sent to ${recipientName}
                    Ref: ${transactionId}
                    New balance: ₦${newSenderBalance.toFixed(2)}`
                );
                        
                await sendSMS(recipientUser.phoneNumber, 
                    `You received ₦${amount.toFixed(2)} from ${user.fullName}
                    ${description ? `${description}\n` : ''}Ref: ${transactionId}
                    Balance: ₦${(recipientUser.walletBalance + amount).toFixed(2)}`
                );
            } else {
                throw new Error('Recipient not found');
            }
        } else {
        // Bank transfer - integrate with Paystack/Flutterwave
        await processNigerianBankTransfer(transaction, user);
        }
        
        // Clean up session
        await smsSessionModel.deleteOne({ _id: session._id });
        
    } catch (error) {
        console.error('Transaction processing error:', error);
        
        // Refund if transaction failed
        await UserModel.updateOne(
        { _id: user._id },
        { $inc: { walletBalance: totalAmount } }
        );
        
        await Transaction.updateOne(
        { transactionId },
        { status: 'failed' }
        );
        
        await sendSMS(user.phoneNumber, 
        "Transaction failed. Your balance has been restored. Try again or contact support.");
    }
};

// Handle balance inquiry with enhanced wallet info
const handleBalanceInquiry = async (user) => {

    // Get recent transactions count
    const recentTransactions = await Transaction.countDocuments({
        $or: [
        { senderPhone: user.phoneNumber },
        { recipientPhone: user.phoneNumber }
        ],
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
    });
    
    // Calculate remaining daily limit
    const today = new Date();
    let remainingLimit = user.wallet.dailyLimit;
    
    if (user.wallet.lastResetDate.toDateString() === today.toDateString()) {
        remainingLimit = user.wallet.dailyLimit - user.wallet.dailySpent;
    }
    
    const message = `Wallet Balance
    ₦${user.wallet.balance.toFixed(2)}

    📊 Daily limit: ₦${remainingLimit.toFixed(2)}
    🏆 Tier: ${user.wallet.tier.toUpperCase()}
    📱 ${user.phoneNumber}
    👤 ${user.fullName}

    ${recentTransactions} transactions (30 days)
    Reply HELP for commands`;
    
    return await sendSMS(user.phoneNumber, message);
};

// Handle status inquiry
const handleStatusInquiry = async (user, message) => {

    const parts = message.split(' ');
    if (parts.length !== 2) {
        return await sendSMS(user.phoneNumber, 
        "Use: STATUS TXN123456");
    }
    
    const txnId = parts[1];
    const transaction = await Transaction.findOne({ 
        transactionId: txnId,
        $or: [
        { senderPhone: user.phoneNumber },
        { recipientPhone: user.phoneNumber }
        ]
    });
    
    if (!transaction) {
        return await sendSMS(user.phoneNumber, 
        "Transaction not found.");
    }
    
    const statusEmoji = {
        'completed': '✅',
        'processing': '⏳',
        'failed': '❌',
        'pending': '🕒'
    };
    
    const statusMessage = `${statusEmoji[transaction.status] || '❓'} Transaction Status
        ${transaction.transactionId}
        ₦${transaction.amount.toFixed(2)}
        ${transaction.recipientName}
        ${transaction.status.toUpperCase()}
        ${transaction.createdAt.toLocaleDateString()}`;
    
    return await sendSMS(user.phoneNumber, statusMessage);
};

// Send help menu
const sendHelpMenu = async (phoneNumber) => {
    const helpMessage = `📱 TextPay Commands:

    PAY 1000 TO 08012345678
    Send to phone number
    
    PAY 5000 TO 1234567890 GTB  
    Send to bank account
    
    BAL - Check balance
    STATUS TXN123456 - Track payment
    HELP - Show commands

    Dial *347*456# for full menu`;
    
    return await sendSMS(phoneNumber, helpMessage);
};

// Calculate transaction fees
const calculateTransactionFee = (amount, type) => {
  if (type === 'phone') {
    // Free for amounts under ₦1000, ₦10 for higher amounts
    return amount < 1000 ? 0 : 10;
  } else {
    // Bank transfer fees
    return amount < 5000 ? 25 : 50;
  }
};

// Normalize Nigerian phone numbers
const normalizeNigerianPhone = (phone) => {
  const cleaned = phone.replace(/\D/g, '');
  
  // 11-digit starting with 0
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return '+234' + cleaned.substring(1);
  }
  
  // 13-digit starting with 234
  if (cleaned.startsWith('234') && cleaned.length === 13) {
    return '+' + cleaned;
  }
  
  // 10-digit (missing country code)
  if (cleaned.length === 10) {
    return '+234' + cleaned;
  }
  
  return phone; // Return as-is if can't normalize
};

// Process Nigerian bank transfers
const processNigerianBankTransfer = async (transaction, sender) => {
  // This will integrate with Paystack Transfer API or Flutterwave Transfer
  // For now, mark as pending manual processing
  
    await Transaction.updateOne(
        { _id: transaction._id },
        { 
        status: 'pending',
        metadata: { 
            ...transaction.metadata,
            requiresManualProcessing: true,
            processingNote: 'Bank transfer requires external processing'
        }
        }
    );
    
    await sendSMS(sender.phoneNumber, 
        `Bank transfer initiated
    Ref: ${transaction.transactionId}
    ₦${transaction.amount.toFixed(2)} to ${transaction.recipientName}

    You'll get confirmation SMS when completed.`);
};

// Main SMS processing router
const processSMSCommand = async (phoneNumber, message) => {
    try {
        const session = await smsSessionModel.findOne({ 
        phoneNumber, 
        expiresAt: { $gt: new Date() } 
        });
        
        // No active session - handle new command
        if (!session) {
        return await handleNewCommand(phoneNumber, message);
        }
        
        // Continue existing session
        switch (session.currentStep) {
        case 'awaiting_confirmation':
            return await handleConfirmation(session, message);
        case 'awaiting_pin':
            return await handlePinInput(session, message);
        default:
            return await handleNewCommand(phoneNumber, message);
        }
    } catch (error) {
        console.error('SMS processing error:', error);
        return await sendSMS(phoneNumber, 
        "System error. Please try again or contact support.");
    }
};

module.exports = {
  handleNewCommand,
  handlePayCommand,
  handleConfirmation,
  handlePinInput,
  processTransaction,
  handleBalanceInquiry,
  handleStatusInquiry,
  sendHelpMenu,
  calculateTransactionFee,
  normalizeNigerianPhone,
  processNigerianBankTransfer,
  processSMSCommand
};