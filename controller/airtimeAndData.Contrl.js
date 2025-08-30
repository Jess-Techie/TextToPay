const TransactionModel = require('../model/Transaction.Model');
const UserModel = require('../model/User.Model');
const { sendSMS, isValidNigerianPhone, normalizeNigerianPhone } = require('./bankingAndSmsUtils.Contrl');
const { generateTransactionReference } = require('./virtualAcctAndPaymentUtils.Contrl');


// Africa's Talking Airtime API
const AfricasTalking = require('africastalking')({
  apiKey: process.env.africasTalkingApiKey,
  username: process.env.africasTalkingApiUsername
});

const airtime = AfricasTalking.AIRTIME;

// Network detection from phone number
const detectNetworkFromPhone = (phoneNumber) => {
  const cleaned = phoneNumber.replace(/\D/g, '');
  const prefix = cleaned.substring(cleaned.length - 11, cleaned.length - 7); // Get 4-digit prefix
  
  const networkPrefixes = {
    '0803': 'MTN', '0806': 'MTN', '0813': 'MTN', '0816': 'MTN', 
    '0810': 'MTN', '0814': 'MTN', '0903': 'MTN', '0906': 'MTN',
    '0805': 'GLO', '0815': 'GLO', '0811': 'GLO', '0905': 'GLO',
    '0802': 'AIRTEL', '0808': 'AIRTEL', '0812': 'AIRTEL', '0701': 'AIRTEL', '0902': 'AIRTEL',
    '0809': '9MOBILE', '0818': '9MOBILE', '0817': '9MOBILE', '0908': '9MOBILE', '0909': '9MOBILE'
  };
  
  return networkPrefixes[prefix] || 'UNKNOWN';
};

// Handle airtime purchase command
const handleAirtimePurchase = async (user, message) => {
  try {
    // Parse: BUY 200 FOR 08123456789 or BUY 500 MTN 08123456789
    // const airtimeRegex = /^BUY\s+(\d+)(?:\s+(MTN|GLO|AIRTEL|9MOBILE))?\s+(?:FOR\s+)?(\d{10,11})$/i;
    const airtimeRegex = /^BUY\s+(\d+)(?:\s+(MTN|GLO|AIRTEL|9MOBILE))?(?:\s+(?:FOR\s+)?(\d{10,11}))?$/i;
    const match = message.match(airtimeRegex);
    
    if (!match) {
      return await sendSMS(user.phoneNumber, 
        ` Invalid format. Use:

        BUY 200 (for yourself)
        BUY 200 FOR 08123456789
        BUY 500 MTN 08123456789

        Amount: ₦50 - ₦10,000`);
    }

    const [, amount, specifiedNetwork, recipient] = match;
    const finalRecipient = recipient || user.phoneNumber;
    
    const amountNum = parseFloat(amount);
    
    // Validate amount
    if (amountNum < 50 || amountNum > 100000) {
      return await sendSMS(user.phoneNumber, 
        " Airtime amount must be between ₦50 and ₦100,000");
    }

    // Validate phone number
    if (!isValidNigerianPhone(finalRecipient)) {
      return await sendSMS(user.phoneNumber, 
        " Invalid phone number format. Use 11-digit Nigerian number.");
    }

    const normalizedRecipient = normalizeNigerianPhone(finalRecipient);
    
    // Detect network if not specified
    const network = specifiedNetwork || detectNetworkFromPhone(normalizedRecipient);
    
    if (network === 'UNKNOWN') {
      return await sendSMS(user.phoneNumber, 
        " Could not detect network. Please specify: BUY 200 MTN 08123456789");
    }

    // Calculate fee (₦10 for airtime purchases)
    const fee = 10;
    const totalAmount = amountNum + fee;
    
    // Check balance
    if (user.walletBalance < totalAmount) {
      return await sendSMS(user.phoneNumber, 
        ` Insufficient balance
        
        Required: ₦${totalAmount.toFixed(2)} (₦${fee} fee)
        Your balance: ₦${user.walletBalance.toFixed(2)}

        Fund your wallet to continue.`);
    }

    // Create transaction reference
    const reference = generateTransactionReference('AIRTIME');
    
    // Create transaction record
    // const transaction = await TransactionModel.create({
    //   transactionId: reference,
    //   userId: user._id.toString(),
    //   senderUserId: user._id.toString(),
    //   senderPhone: user.phoneNumber,
    //   recipientPhone: normalizedRecipient,
    //   recipientName: `${network} Airtime`,
    //   amount: amountNum,
    //   fees: fee,
    //   description: `${network} ₦${amountNum} airtime`,
    //   status: 'processing',
    //   transferType: 'airtime',
    //   paymentMethod: 'wallet',
    //   metadata: {
    //     network: network,
    //     airtimeAmount: amountNum,
    //     initiatedVia: 'sms',
    //     serviceType: 'airtime_purchase'
    //   }
    // });

    const transaction = await TransactionModel.create({
      transactionId: reference,
      userId: user._id,
      senderUserId: user._id,
      amount: amountNum,
      fees: fee,
      description: `${network} ₦${amountNum} airtime to ${finalRecipient}`,
      status: 'processing',
      transferType: 'airtime',
      paymentMethod: 'airtime_purchase',
      recipientBankDetails: {
        accountNumber: normalizedRecipient,
        accountName: `${network} Airtime`,
        bankName: network,
        bankCode: network
      },
      metadata: {
        initiatedVia: 'sms',
        network: network,
        airtimeAmount: amountNum,
        serviceType: 'airtime_purchase'
      }
    });
    try {
      // Deduct from wallet first
      await UserModel.updateOne(
        { _id: user._id },
        { $inc: { walletBalance: -totalAmount } }
      );

      // Process airtime purchase
      const airtimeResult = await purchaseAirtime(normalizedRecipient, amountNum, network);
      
      if (airtimeResult.success) {
        // Update transaction as successful
        await TransactionModel.updateOne(
          { _id: transaction._id },
          { 
            status: 'completed',
            completedAt: new Date(),
            'metadata.providerId': airtimeResult.transactionId,
            'metadata.providerResponse': airtimeResult.response
          }
        );

        const newBalance = user.walletBalance - totalAmount;
        
        // Send success SMS
        return await sendSMS(user.phoneNumber, 
          ` Airtime purchase successful!
          
            ₦${amountNum} ${network} airtime sent to ${finalRecipient}
            Fee: ₦${fee}
            Ref: ${reference}
            New balance: ₦${newBalance.toFixed(2)}

            Thank you for using TextToPay! `);

      } else {
        throw new Error(airtimeResult.error);
      }

    } catch (error) {
      console.error('Airtime purchase failed:', error);
      
      // Refund wallet
      await UserModel.updateOne(
        { _id: user._id },
        { $inc: { walletBalance: totalAmount } }
      );

      // Update transaction as failed
      await TransactionModel.updateOne(
        { _id: transaction._id },
        { 
          status: 'failed',
          'metadata.errorMessage': error.message
        }
      );

      return await sendSMS(user.phoneNumber, 
        ` Airtime purchase failed: ${error.message}
        
        Your balance has been restored.
        Ref: ${reference}`);
    }

  } catch (error) {
    console.error('Airtime command processing error:', error);
    return await sendSMS(user.phoneNumber, 
      " System error. Please try again or contact support.");
  }
};

// Purchase airtime using Africa's Talking
const purchaseAirtime = async (phoneNumber, amount, network) => {
  try {
    console.log(` Purchasing ₦${amount} ${network} airtime for ${phoneNumber}`);

    const airtimeData = {
      recipients: [{
        phoneNumber: phoneNumber,
        currencyCode: 'NGN',
        // amount: `NGN ${amount}`
        amount: amount
      }]
    };

    const response = await airtime.send(airtimeData);
    console.log("Africa's Talking response:", JSON.stringify(response, null, 2));

    if (response.responses && response.responses?.length > 0) {
      const result = response.responses[0];
      
      if (result.status === 'Sent' || result.status === 'Success') {
        return {
          success: true,
          transactionId: result.requestId,
          response: result
        };
      } else if (result.errorMessage && result.errorMessage !== 'None') {
        throw new Error(result.errorMessage);
      } else {
        throw new Error('Airtime purchase failed');
      }
    }

    throw new Error('No response from airtime provider');

  } catch (error) {
    console.error('Africa\'s Talking airtime error:', error);
    return {
      success: false,
      error: error.message || 'Airtime service unavailable'
    };
  }
};

// Handle data purchase command
const handleDataPurchase = async (user, message) => {
  try {
    // Parse: DATA 1GB MTN 08123456789 or DATA 500MB FOR 08123456789
    const dataRegex = /^DATA\s+([\d.]+)(GB|MB)\s+(?:(MTN|GLO|AIRTEL|9MOBILE)\s+)?(?:FOR\s+)?(\d{10,11})$/i;
    const match = message.match(dataRegex);
    
    if (!match) {
      return await sendSMS(user.phoneNumber, 
        ` Invalid format. Use:
        
        DATA 1GB MTN 08123456789
        DATA 500MB FOR 08123456789

        Available: 100MB-100GB`);
    }

    const [size, unit, specifiedNetwork, recipient] = match;
    const sizeNum = parseFloat(size);
    
    // Convert to MB for calculation
    const sizeInMB = unit.toUpperCase() === 'GB' ? sizeNum * 1024 : sizeNum;
    
    // Validate data size
    if (sizeInMB < 100 || sizeInMB > 102400) { // 100MB to 100GB
      return await sendSMS(user.phoneNumber, 
        " Data size must be between 100MB and 100GB");
    }

    // Validate phone number
    if (!isValidNigerianPhone(recipient)) {
      return await sendSMS(user.phoneNumber, 
        " Invalid phone number format.");
    }

    const normalizedRecipient = normalizeNigerianPhone(recipient);
    
    // Detect network if not specified
    const network = specifiedNetwork || detectNetworkFromPhone(normalizedRecipient);
    
    if (network === 'UNKNOWN') {
      return await sendSMS(user.phoneNumber, 
        " Could not detect network. Please specify: DATA 1GB MTN 08123456789");
    }

    // Calculate data cost (simplified pricing)
    const dataPrice = calculateDataPrice(sizeInMB, network);
    const fee = 25; // ₦25 fee for data purchases
    const totalAmount = dataPrice + fee;
    
    // Check balance
    if (user.walletBalance < totalAmount) {
      return await sendSMS(user.phoneNumber, 
        ` Insufficient balance
        
        Required: ₦${totalAmount.toFixed(2)} (₦${fee} fee)
        Data cost: ₦${dataPrice}
        Your balance: ₦${user.walletBalance.toFixed(2)}`);
    }

    return await sendSMS(user.phoneNumber, 
      ` Data purchase coming soon!
      
        We're integrating data bundle APIs.
        For now, use BUY command for airtime.

        ${size}${unit} ${network} data would cost ₦${dataPrice}`);

  } catch (error) {
    console.error('Data command processing error:', error);
    return await sendSMS(user.phoneNumber, 
      " System error. Please try again.");
  }
};

// Calculate data bundle prices (simplified)
const calculateDataPrice = (sizeInMB, network) => {
  const baseRates = {
    'MTN': 4.5,    // ₦4.5 per MB
    'GLO': 4.0,    // ₦4.0 per MB  
    'AIRTEL': 4.2, // ₦4.2 per MB
    '9MOBILE': 4.0 // ₦4.0 per MB
  };
  
  const rate = baseRates[network] || 4.5;
  let price = sizeInMB * rate;
  
  // Volume discounts
  if (sizeInMB >= 1024) price *= 0.8; // 20% off for 1GB+
  if (sizeInMB >= 2048) price *= 0.9; // Additional 10% off for 2GB+
  
  return Math.ceil(price);
};

// Get airtime/data transaction history
const getAirtimeHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20 } = req.query;
    
    const user = await UserModel.findById(userId);

    // const transactions = await TransactionModel.find({
    //   senderPhone: user.phoneNumber,
    //   paymentMethod: { $in: ['airtime_purchase', 'data_purchase'] }
    // })
    
    const transactions = await TransactionModel.find({
      senderUserId: userId,
      transferType: { $in: ['airtime', 'data'] }
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    res.json({
      success: true,
      transactions: transactions.map(txn => ({
        id: txn.transactionId,
        type: txn.paymentMethod,
        amount: txn.amount,
        fees: txn.fees,
        recipient: txn.recipientPhone,
        network: txn.metadata?.network,
        status: txn.status,
        createdAt: txn.createdAt,
        completedAt: txn.completedAt
      }))
    });

  } catch (error) {
    console.error('Airtime history error:', error);
    res.status(500).json({ error: 'Failed to fetch airtime history' });
  }
};

module.exports = {
  handleAirtimePurchase,
  handleDataPurchase,
  purchaseAirtime,
  detectNetworkFromPhone,
  calculateDataPrice,
  getAirtimeHistory
};