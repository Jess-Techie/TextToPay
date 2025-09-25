const smsSessionModel = require("../model/smsSession.Model");
const UserModel = require("../model/User.Model");
const TransactionModel = require("../model/Transaction.Model");
const bcrypt = require('bcryptjs');
const { updatePin, verifyPhone, resendOTP, initiateRegistration, completeRegistration } = require("./userContrl");
const { processBankTransfer, generateTransactionReference, resolveBankByCode, resolveAccountName } = require("./virtualAcctAndPaymentUtils.Contrl");
const { normalizeNigerianPhone, sendSMS } = require("./bankingAndSmsUtils.Contrl");
const { handleAirtimePurchase, handleDataPurchase } = require("./airtimeAndData.Contrl");

// Main SMS router - handles all incoming SMS
const processSMSCommand = async (phoneNumber, message) => {
  try {
    const normalizedPhone = normalizeNigerianPhone(phoneNumber);
    const cleanMessage = message.trim().toUpperCase();
    
    console.log(`📱 SMS from ${normalizedPhone}: ${cleanMessage}`);

    // Check for active SMS session first
    const session = await smsSessionModel.findOne({ 
      phoneNumber: normalizedPhone, 
      expiresAt: { $gt: new Date() } 
    });

    if (session) {
      return await handleSessionCommand(session, message);
    }

    // Handle registration commands
    if (['START', 'BEGIN', 'REGISTER', 'REG'].some(cmd => cleanMessage.startsWith(cmd))) {
      if (cleanMessage.startsWith('REG ')) {
        return await completeRegistration(normalizedPhone, message);
      } else {
        return await initiateRegistration(normalizedPhone, message);
      }
    }

    // Handle verification
    if (cleanMessage.startsWith('VERIFY ')) {
      return await verifyPhone(normalizedPhone, message);
    }

    // Resend OTP
    if (['RESEND', 'CODE', 'OTP'].includes(cleanMessage)) {
      return await resendOTP(normalizedPhone);
    }

    // Reset / update PIN commands
    if (['RESET', 'RESETPIN'].includes(cleanMessage)) {
      return await updatePin(normalizedPhone);
    }

    // Commands for registered users only
    const user = await UserModel.findOne({
      phoneNumber: normalizedPhone,
      isPhoneVerified: true,
      status: 'active'
    });

    if (!user) {
      return await sendSMS(normalizedPhone, 
        ` Please register first!
        
        Text START to begin registration
        or HELP for full menu.

        New to TextToPay? Get started in 2 minutes! `);
    }

    // Route registered user commands
    return await handleUserCommand(user, cleanMessage);

  } catch (error) {
    console.error('SMS processing error:', error);
    return await sendSMS(phoneNumber, 
      " System temporarily unavailable. Please try again in a moment.");
  }
};

// Handle commands for registered users
const handleUserCommand = async (user, message) => {
  try {
    // Balance inquiry
    if (['BAL', 'BALANCE', 'WALLET'].includes(message)) {
      return await handleBalanceInquiry(user);
    }

    // Help/Menu
    if (['HELP', 'MENU', 'COMMANDS'].includes(message)) {
      return await sendHelpMenu(user.phoneNumber);
    }

    // Pay command
    if (message.startsWith('PAY ')) {
      return await handlePayCommand(user, message);
    }

    // Airtime purchase
    if (message.startsWith('BUY ')) {
      return await handleAirtimePurchase(user, message);
    }

    // Data purchase (coming soon)
    if (message.startsWith('DATA ')) {
      return await handleDataPurchase(user, message);
    }

    // Transaction status
    if (message.startsWith('STATUS ')) {
      return await handleStatusInquiry(user, message);
    }

    // Transaction history
    if (['HISTORY', 'TRANSACTIONS', 'TXN'].includes(message)) {
      return await sendRecentTransactions(user);
    }

    // Account details
    if (['ACCOUNT', 'DETAILS', 'INFO'].includes(message)) {
      return await sendAccountDetails(user);
    }

    // Invalid command
    return await sendSMS(user.phoneNumber, 
      ` Unknown command: ${message.substring(0, 20)}...
        Reply HELP for available commands
        or for full menu.`);

  } catch (error) {
    console.error('User command error:', error);
    return await sendSMS(user.phoneNumber, 
      " Command failed. Please try again.");
  }
};

// Handle SMS sessions (payment confirmations, PIN entry)
const handleSessionCommand = async (session, message) => {
  try {
    const cleanMessage = message.trim().toUpperCase();

    switch (session.currentStep) {
      case 'awaiting_confirmation':
        return await handlePaymentConfirmation(session, cleanMessage);
        
      case 'awaiting_pin':
        return await handlePinInput(session, message.trim());
        
      default:
        // Invalid session state, clean up
        await smsSessionModel.deleteOne({ _id: session._id });
        return await sendSMS(session.phoneNumber, 
          " Session expired. Please try again.");
    }

  } catch (error) {
    console.error('Session command error:', error);
    return await sendSMS(session.phoneNumber, 
      " Session error. Please try again.");
  }
};

//handle pay command
const handlePayCommand = async (user, message) => {
  try {
    // Parse various formats:
    // PAY 1000 TO 1234567890 (virtual account)
    // PAY 5000 TO 1234567890 GTB (bank transfer)
    // PAY 2000 TO 1234567890 FOR lunch
    const payRegex = /^PAY\s+(\d+(?:\.\d{2})?)\s+TO\s+(\d{10,11})(?:\s+([A-Z]{2,10}))?(?:\s+FOR\s+(.+))?$/i;
    const match = message.match(payRegex);
    
    if (!match) {
      return await sendSMS(user.phoneNumber, 
        ` Invalid format. Use:
        
        💸 Virtual Account transfer:
        PAY 1000 TO 1234567890

        🏦 Bank transfer:
        PAY 5000 TO 1234567890 GTB

        📝 With description:
        PAY 2000 TO 1234567890 FOR lunch`);
    }

    const [ , amount, recipient, bankCode, description = ''] = match;
    const amountNum = parseFloat(amount);
    
    // Validate amount
    if (amountNum < 10 || amountNum > 500000) {
      return await sendSMS(user.phoneNumber, 
        " Amount must be between ₦10 and ₦500,000");
    }

    // Check if user has virtual account
    if (!user.virtualAccount || !user.virtualAccount?.accountNumber) {
      return await sendSMS(user.phoneNumber, 
        ` Virtual account not ready. Please wait a moment and try again.`);
    }
    console.log('user.virtualAccount:', user.virtualAccount);
    console.log('virtualAccount structure:', JSON.stringify(user.virtualAccount, null, 2));

    // Determine transfer type based on bank code presence
    const transferType = bankCode ? 'bank_transfer' : 'internal';
    const fee = transferType === 'internal' ? 0 : 50; // No fee for internal transfers
    const totalAmount = amountNum + fee;
    
    // Check balance
    if (user.walletBalance < totalAmount) {
      return await sendSMS(user.phoneNumber, 
        ` Insufficient balance
        
        Required: ₦${totalAmount.toFixed(2)}${fee > 0 ? ` (₦${fee} fee)` : ''}
        Your balance: ₦${user.walletBalance.toFixed(2)}

        💡 Fund your account:
        Transfer to: ${user.virtualAccount?.accountNumber || 'N/A'}
        Bank: ${user.virtualAccount?.bankName || 'Your Bank'}`);
    }

    let recipientName = 'Unknown';
    let recipientDetails = {};
    let recipientUser = null;

    if (transferType === 'bank_transfer') {
      // External bank transfer
      const bank = await resolveBankByCode(bankCode);
      if (!bank) {
        return await sendSMS(user.phoneNumber, 
          ` Invalid bank code: ${bankCode}
          
          Popular codes: GTB, UBA, ACCESS, ZENITH, FCMB, FBN`);
      }

      //
      if (recipient === '0000000000') {
        recipientName = 'Test Account';
        recipientDetails = {
          accountNumber: recipient,
          accountName: recipientName,
          bankName: bank.name,
          bankCode: bank.code
        };
      } else {
        const resolution = await resolveAccountName(recipient, bank.code);
        if (!resolution.success) {
          return await sendSMS(user.phoneNumber, 
            ` Account resolution failed: ${resolution.error}`);
        }

        recipientName = resolution.data.accountName;
        recipientDetails = {
          accountNumber: recipient,
          accountName: recipientName,
          bankName: bank.name,
          bankCode: bank.code
        };
    }

    } else {
      // Internal transfer - find recipient by virtual account
      recipientUser = await UserModel.findOne({ 
        'virtualAccount.accountNumber': recipient,
        status: 'active' 
      });
      
      if (!recipientUser) {
        return await sendSMS(user.phoneNumber, 
          ` Virtual account not found: ${recipient}
          
          💡 For bank transfers, add bank code:
          PAY ${amountNum} TO ${recipient} GTB`);
      }

      // Prevent self-transfer
      if (recipientUser._id.toString() === user._id.toString()) {
        return await sendSMS(user.phoneNumber, 
          ` Cannot transfer to yourself`);
      }

      recipientName = recipientUser.fullName || recipientUser.virtualAccount?.accountName;
      recipientDetails = {
        accountNumber: recipient,
        accountName: recipientName,
        userId: recipientUser._id.toString() //convert objectId to string
      };
    }

    // Generate transaction ID
    const transactionId =  generateTransactionReference('TXN');//`TXN_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Create SMS session for confirmation
    const sessionId = `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    await smsSessionModel.create({
      userId: user._id,
      phoneNumber: user.phoneNumber,
      sessionId,
      currentStep: 'awaiting_confirmation',
      transactionData: {
        transactionId,
        amount: amountNum,
        recipient,
        recipientName,
        recipientDetails,
        recipientUserId: recipientUser?._id.toString(), // Store recipient userId if internal || convert to string
        description: description.trim(),
        transferType,
        bankCode,
        fee,
        totalAmount,
        // senderVirtualAccount: {
        //   accountNumber: user.virtualAccount?.accountNumber,
        //   accountName: user.virtualAccount?.accountName || user.fullName
        // }
        senderVirtualAccount: user.virtualAccount 
          ? {
              accountNumber: user.virtualAccount?.accountNumber,
              accountName: user.virtualAccount?.accountName || user.fullName
            }
          : {
          accountNumber: 'N/A',
          accountName: user.fullName
        },

      },
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    });

    const transferTypeText = transferType === 'internal' ? ' Internal Transfer' : ' Bank Transfer';
    const confirmMessage = ` Confirm Payment
    
    ${transferTypeText}
    Send ₦${amountNum.toFixed(2)} to:
     ${recipientName}
     ${recipient}${transferType === 'bank_transfer' ? `\n ${recipientDetails.bankName}` : ''}${description ? `\n For: ${description}` : ''}${fee > 0 ? `\n Fee: ₦${fee.toFixed(2)}` : ''}
     Total: ₦${totalAmount.toFixed(2)}

      Reply YES to confirm
      Reply NO to cancel
      
      Expires in 5 minutes`;
    
    return await sendSMS(user.phoneNumber, confirmMessage);

  } catch (error) {
    console.error('Pay command error:', error);
    return await sendSMS(user.phoneNumber, 
    "Payment setup failed. Please try again.");
  }
};

// Handle payment confirmation
// const handlePaymentConfirmation = async (session, message) => {
//   try {
//     if (['NO', 'CANCEL', 'STOP'].includes(message)) {
//       await smsSessionModel.deleteOne({ _id: session._id });
//       return await sendSMS(session.phoneNumber, 
//         " Payment cancelled. Your money is safe! ");
//     }
    
//     if (!['YES', 'CONFIRM', 'OK'].includes(message)) {
//       return await sendSMS(session.phoneNumber, 
//         ` Please confirm:
                
//         Reply YES to proceed
//         Reply NO to cancel`);
//     }
    
//     // Update session to await PIN
//     await smsSessionModel.updateOne(
//       { _id: session._id },
//       { currentStep: 'awaiting_pin' }
//     );
    
//     return await sendSMS(session.phoneNumber, 
//       ` Enter your 4-digit PIN to complete payment:
      
//         Keep your PIN secure!`);

//   } catch (error) {
//     console.error('Confirmation error:', error);
//     return await sendSMS(session.phoneNumber, 
//       " Confirmation failed. Please try again.");
//   }
// };
const handlePaymentConfirmation = async (session, message) => {
    try {
      if (['NO', 'CANCEL', 'STOP'].includes(message)) {
        await smsSessionModel.deleteOne({ _id: session._id });
        return await sendSMS(session.phoneNumber, 
          "Payment cancelled. Your money is safe!");
      }
      
      if (!['YES', 'CONFIRM', 'OK'].includes(message)) {
        return await sendSMS(session.phoneNumber, 
          `Please confirm:
          
          Reply YES to proceed
          Reply NO to cancel`);
      }
      
      // Update session to await USSD PIN
      await smsSessionModel.updateOne(
        { _id: session._id },
        { currentStep: 'awaiting_ussd_pin' }
      );

      const sessionCode = session.sessionId.slice(-4); // Last 4 characters

      return await sendSMS(session.phoneNumber, 
        `To complete payment securely:

        Dial *384*23125# 
        Select: 1. TextToPay Transactions  
        Enter session ID: ${sessionCode}
        Enter your 4-digit PIN

        Session expires in 5 minutes`);

    } catch (error) {
      console.error('Confirmation error:', error);
      return await sendSMS(session.phoneNumber, 
        "Confirmation failed. Please try again.");
    }
};

// Handle PIN input and process payment
const handlePinInput = async (session, pin) => {
    try {
        if (!/^\d{4}$/.test(pin)) {
        return await sendSMS(session.phoneNumber, 
            " Invalid PIN format. Enter 4 digits:");
        }
        
        const user = await UserModel.findOne({ phoneNumber: session.phoneNumber }).lean();
        const isValidPin = await bcrypt.compare(pin, user.pin);
        
        if (!isValidPin) {
        // Increment failed attempts
        await smsSessionModel.updateOne(
            { _id: session._id },
            { $inc: { 'transactionData.pinAttempts': 1 } }
        );
        
        const attempts = (session.transactionData.pinAttempts || 0) + 1;
        
        if (attempts >= 3) {
            await smsSessionModel.deleteOne({ _id: session._id });
            return await sendSMS(session.phoneNumber, 
            ` Too many failed PIN attempts!
            
                Payment cancelled for security.
                Contact support if needed.`);
        }
        
        return await sendSMS(session.phoneNumber, 
            `Incorrect PIN (${attempts}/3 attempts)
            
            Try again:`);
        }
        
        // Process the transaction
        return await processPaymentTransaction(user, session);

    } catch (error) {
        console.error('PIN processing error:', error);
        return await sendSMS(session.phoneNumber, 
        " PIN verification failed. Please try again.");
    }
};

// Process the actual payment transaction
const processPaymentTransaction = async (user, session) => {
  let totalAmount = 0; // Initialize with default value
  let transactionId; // to be accessible in catch block
  try {
      const { 
        amount, 
        recipientName, 
        recipientDetails, 
        description, 
        transferType, 
        fee, 
        totalAmount: sessionTotalAmount,
        senderVirtualAccount  // Get it from session
      } = session.transactionData;
      
      console.log('session.transactionData:', JSON.stringify(session.transactionData, null, 2));
      console.log('recipientDetails from session:', recipientDetails);

      
      totalAmount = sessionTotalAmount || (amount + fee); // Assign with fallback
      transactionId = generateTransactionReference('TXN'); // Assign it here to match with the rest of the code

      // Final balance check
      const currentUser = await UserModel.findById(user._id);
      if (currentUser.walletBalance < totalAmount) {
        await smsSessionModel.deleteOne({ _id: session._id });
        return await sendSMS(currentUser.phoneNumber, 
          " Insufficient balance. Transaction cancelled.");
      }
      
      // const transactionId = generateTransactionReference('TXN');
      
      // Create transaction record
      const transaction = await TransactionModel.create({
        userId: user._id,
        transactionId,
        senderUserId: user._id,
        // senderVirtualAccount: {
        //   accountNumber: user.virtualAccount?.accountNumber || 'N/A',
        //   accountName: user.virtualAccount?.accountName || user.fullName
        // },
        senderVirtualAccount: user.virtualAccount
          ? {
              accountNumber: user.virtualAccount?.accountNumber,
              accountName: user.virtualAccount?.accountName || user.fullName
            }
          : {
              accountNumber: 'N/A',
              accountName: user.fullName
            },
        // senderVirtualAccount,  // Use from session instead of currentUser
        amount,
        fees: fee,
        description,
        status: 'processing',
        transferType, // This is already 'internal' or 'bank_transfer' from handlePayCommand
        paymentMethod: 'wallet',
        recipientName,
        ...(transferType === 'internal' 
          ? { 
              recipientUserId: recipientDetails.userId,
              recipientVirtualAccount: {
                accountNumber: recipientDetails.accountNumber,
                accountName: recipientName
              }
            }
          : {
              recipientBankDetails: {
                accountNumber: recipientDetails.accountNumber,
                accountName: recipientName,
                bankName: recipientDetails.bankName,
                bankCode: recipientDetails.bankCode
              }
            }
        ),
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
      
      if (transferType === 'internal') {
        // Internal wallet transfer
        // const recipientUser = await UserModel.findById(recipientDetails.recipientId);
        const recipientUser = await UserModel.findById(recipientDetails.userId);

        if (recipientUser) {
          // Credit recipient
          await UserModel.updateOne(
            { _id: recipientUser._id },
            { $inc: { walletBalance: amount } }
          );
          
          await TransactionModel.updateOne(
            { _id: transaction._id },
            { status: 'completed', completedAt: new Date() }
          );
          
          const newSenderBalance = currentUser.walletBalance - totalAmount;
          
          // Notify sender
          await sendSMS(user.phoneNumber, 
            ` Payment Successful!
            
              ₦${amount.toFixed(2)} sent to ${recipientName}
              ${description ? ` ${description}\n` : ''} Fee: ₦${fee}
              Ref: ${transactionId}
              Balance: ₦${newSenderBalance.toFixed(2)}

              Thank you! `);
          
          // Notify recipient
          const newRecipientBalance = recipientUser.walletBalance + amount;
          await sendSMS(recipientUser.phoneNumber, 
            ` Money Received!
            
              ₦${amount.toFixed(2)} from ${user.fullName}
              ${description ? ` ${description}\n` : ''} Ref: ${transactionId}
              Balance: ₦${newRecipientBalance.toFixed(2)}

              Text HELP for commands`);
            
        } else {
          throw new Error('Recipient not found');
        }
        
      } else {
        // Bank transfer - use Korapay
        const transferResult = await processBankTransfer({
          recipientBank: recipientDetails.bankCode,
          recipientAccount: recipientDetails.accountNumber,
          amount,
          narration: description || `TextToPay transfer from ${user.fullName}`,
          reference: transactionId,
          senderName: user.fullName
        });
        
        if (transferResult.success) {
          await TransactionModel.updateOne(
            { _id: transaction._id },
            { 
              status: 'completed', 
              completedAt: new Date(),
              'metadata.korapayId': transferResult.data.korapayId
            }
          );
          
          const newBalance = currentUser.walletBalance - totalAmount;
          
          await sendSMS(user.phoneNumber, 
            ` Bank Transfer Successful!
            
              ₦${amount.toFixed(2)} sent to:
              ${recipientName}
              ${recipientDetails.bankName}
              ${description ? ` ${description}\n` : ''} Fee: ₦${fee}
              Ref: ${transactionId}
              Balance: ₦${newBalance.toFixed(2)}

              Transfer completed! `);
          
        } else {
          throw new Error(transferResult.error);
        }
      }
      
      // Clean up session
      await smsSessionModel.deleteOne({ _id: session._id });
      
  } catch (error) {
    console.error('Transaction processing error:', error);
    
    // Refund if transaction failed
    if(totalAmount > 0){
      await UserModel.updateOne(
        { _id: user._id },
        { $inc: { walletBalance: totalAmount } }
      );
    }

    await TransactionModel.updateOne(
      { transactionId },
      { 
        status: 'failed',
        'metadata.errorMessage': error.message
      }
    );
    
    await sendSMS(user.phoneNumber, 
      ` Payment Failed: ${error.message}
      
        Your balance has been restored.
        🔍 Ref: ${transactionId}

        Please try again or contact support.`);
  }
};

// Enhanced balance inquiry
const handleBalanceInquiry = async (user) => {
  try {
    // Get recent transactions count
    const recentCount = await TransactionModel.countDocuments({
      $or: [
        { senderUserId: user._id },
        { recipientUserId: user._id }
      ],
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });
    
    const message = ` Wallet Balance:\n
            
         ₦${user.walletBalance.toFixed(2)}
         ${user.phoneNumber}
         ${user.fullName}

        ${user.virtualAccount ? `\n Fund Account: ${user.virtualAccount?.accountNumber}
         ${user.virtualAccount?.bankName}

        ` : ''} \n${recentCount} transactions (30 days)

         Reply HELP for commands
        `;
    
    return await sendSMS(user.phoneNumber, message);

  } catch (error) {
    console.error('Balance inquiry error:', error);
    return await sendSMS(user.phoneNumber, 
      " Balance check failed. Please try again.");
  }
};

// Handle status inquiry
const handleStatusInquiry = async (user, message) => {
  try {
    const parts = message.split(' ');
    if (parts.length !== 2) {
      return await sendSMS(user.phoneNumber, 
        ` Use format: STATUS TXN123456
        
            Get transaction reference from payment confirmation SMS.`);
    }
    
    const txnId = parts[1];
    const transaction = await TransactionModel.findOne({ 
      transactionId: txnId,
      $or: [
        { senderUserId: user._id },
        { recipientUserId: user._id }
      ]
    });
    
    if (!transaction) {
      return await sendSMS(user.phoneNumber, 
        ` Transaction not found: ${txnId}
        
            Check the reference number and try again.`);
    }
    
    const statusEmoji = {
      'completed': '✅',
      'processing': '⏳',
      'failed': '❌',
      'pending': '🕒'
    };
    
    const isSent = transaction.senderUserId?.toString() === user._id.toString();
    const statusMessage = `${statusEmoji[transaction.status]} Transaction Status
    
        🔍 ${transaction.transactionId}
        💰 ₦${transaction.amount.toFixed(2)}
        ${isSent ? '📤' : '📥'} ${isSent ? 'TO' : 'FROM'}: ${transaction.recipientName}
        📊 ${transaction.status.toUpperCase()}
        📅 ${transaction.createdAt.toLocaleDateString('en-NG')}

        ${transaction.description ? `📝 ${transaction.description}` : ''}`;
    
    return await sendSMS(user.phoneNumber, statusMessage);

  } catch (error) {
    console.error('Status inquiry error:', error);
    return await sendSMS(user.phoneNumber, 
      " Status check failed. Please try again.");
  }
};

// Send recent transactions
const sendRecentTransactions = async (user) => {
  try {
    const transactions = await TransactionModel.find({
      $or: [
        { senderUserId: user._id },
        { recipientUserId: user._id }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(5);
    
    if (transactions.length === 0) {
      return await sendSMS(user.phoneNumber, 
        ` Transaction History
                    
            No transactions yet.

            Send your first payment:
            PAY 1000 TO 1234567890

            Buy airtime: BUY 200 08123456789 MTN`);
    }
    
    let message = ` Recent Transactions (Last 5)
    
`;
    
    transactions.forEach((txn, index) => {
      const isSent = txn.senderUserId?.toString() === user._id.toString();
      const emoji = isSent ? '📤' : '📥';
      const status = txn.status === 'completed' ? '✅' : 
                    txn.status === 'failed' ? '❌' : '⏳';
      
      message += `${emoji} ₦${txn.amount} ${isSent ? 'to' : 'from'} ${txn.recipientName} ${status}
`;
    });
    
    message += `
    💡 Check status: STATUS TXN123456
    📱 Full history: HELP `;//Dial *347*456#
    
    return await sendSMS(user.phoneNumber, message);

  } catch (error) {
    console.error('Transaction history error:', error);
    return await sendSMS(user.phoneNumber, 
      " History unavailable. Please try again.");
  }
};

// Send account details
const sendAccountDetails = async (user) => {
  try {
    const message = ` Account Details
            
        ${user.phoneNumber}
        ${user.fullName}
        Balance: ₦${user.walletBalance.toFixed(2)}
        ${user.bvnVerified ? '✅' : '⚠️'} BVN Verified\n
        Joined: ${user.createdAt.toLocaleDateString('en-NG')}\n

        ${user.virtualAccount ? `🏦 Funding Account:\n
        ${user.virtualAccount?.accountNumber || 'N/A'}\n
        ${user.virtualAccount?.bankName || 'your bank'}

        ` : ''} Need help? Text HELP
        `;
    
    return await sendSMS(user.phoneNumber, message);

  } catch (error) {
    console.error('Account details error:', error);
    return await sendSMS(user.phoneNumber, 
      " Account details unavailable. Please try again.");
  }
};

// Send comprehensive help menu
const sendHelpMenu = async (phoneNumber) => {
  try {
    const helpMessage = `📱 TextToPay Commands\n
    
        💸 PAYMENTS:\n
        PAY 1000 TO 1234567890\n
        PAY 5000 TO 1234567890 GTB\n
        PAY 5000 TO 1234567890 GTB lunch(with description)\n

        📞 AIRTIME:\n
        BUY 200 MTN (For yourself)\n
        BUY 200 08123456789 MTN\n
        BUY 200 FOR 08123456789 MTN\n

        🔍 ACCOUNT:\n
        BAL - Check balance\n
        STATUS TXN123456 - Track payment\n
        HISTORY - Recent transactions\n
        ACCOUNT - Your details\n

        🛠️ ACCOUNT SETUP:\n
        RESET - Reset your PIN\n

        📞 Support: HELP\n
        💡 More features coming soon!

        Ready to send money? `;
    
    return await sendSMS(phoneNumber, helpMessage);

  } catch (error) {
    console.error('Help menu error:', error);
    return await sendSMS(phoneNumber, 
      " Help unavailable. Dial *347*456# for support.");
  }
};

module.exports = {
  processSMSCommand,
  handleUserCommand,
  handleSessionCommand,
  handlePayCommand,
  handlePaymentConfirmation,
  handlePinInput,
  processPaymentTransaction,
  handleBalanceInquiry,
  handleStatusInquiry,
  sendRecentTransactions,
  sendAccountDetails,
  sendHelpMenu
};