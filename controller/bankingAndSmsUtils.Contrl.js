const axios = require('axios');
const crypto = require('crypto');


// Send SMS via Africa's Talking
const sendSMS = async (phoneNumber, message) => {
  try {
    const credentials = {
      apiKey: process.env.africasTalkingApiKey,
      username: process.env.africasTalkingApiUsername
    };
    
    const AfricasTalking = require('africastalking')(credentials);
    const sms = AfricasTalking.SMS;
    
    const options = {
      to: phoneNumber,
      message: message,
      // from: 'AFRICASTKNG'//process.env.africasTalkingSmsSenderId ||  // based on their documentation cox we are using sandbox
    };
    
    const result = await sms.send(options);
    console.log('📱 SMS sent:', result);
    
    return {
      success: true,
      messageId: result.SMSMessageData?.Recipients[0]?.messageId,
      status: result.SMSMessageData?.Recipients[0]?.status
    };
    
  } catch (error) {
    console.error(' SMS sending failed:', error);
    return { success: false, error: error.message };
  }
};

const isValidNigerianPhone = (phone) => {
  const cleaned = phone.replace(/\D/g, '');
  
  // Nigerian mobile number patterns
  const nigerianPrefixes = [
    '0701', '0702', '0703', '0704', '0705', '0706', '0707', '0708', '0709', // 9mobile
    '0801', '0802', '0803', '0804', '0805', '0806', '0807', '0808', '0809', '0810', '0811', '0812', '0813', '0814', '0815', '0816', '0817', '0818', '0819', // MTN
    '0901', '0902', '0903', '0904', '0905', '0906', '0907', '0908', '0909', '0913', '0915', '0916', '0917', '0918', // Airtel
    '0704', '0708', '0709', '0901', '0902', '0907', '0908', '0909', '0913', '0915', '0916', '0917', '0918' // Glo
  ];
  
  // Check 11-digit format starting with 0
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    return nigerianPrefixes.some(prefix => cleaned.startsWith(prefix));
  }
  
  // Check 13-digit format starting with 234
  if (cleaned.length === 13 && cleaned.startsWith('234')) {
    const with0 = '0' + cleaned.substring(3);
    return nigerianPrefixes.some(prefix => with0.startsWith(prefix));
  }
  
  return false;
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

// Generate OTP
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

// Hash PIN/Password
const hashPin = async (pin) => {
  const bcrypt = require('bcryptjs');
  return await bcrypt.hash(pin, 10);
};

// Validate PIN format
const isValidPin = (pin) => {
  return /^\d{4,6}$/.test(pin); // 4-6 digit PIN
};

// Format currency
const formatNaira = (amount) => {
  return `₦${parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};

// Rate limiting key generator
const generateRateLimitKey = (phoneNumber, action) => {
  return `${action}_${phoneNumber.replace(/\+/g, '')}`;
};

// Log SMS interaction
const logSMSInteraction = async (phoneNumber, message, direction, status = 'sent') => {
  const timestamp = new Date().toISOString();
  console.log(`📱 [${timestamp}] SMS ${direction.toUpperCase()}: ${phoneNumber} - ${message} [${status}]`);
  
  // Here you could save to database or external logging service
  // await SMSLog.create({ phoneNumber, message, direction, status, timestamp });
};



// Get transaction fees
// const calculateTransactionFee = (amount, type) => {
//   // Internal wallet transfers
//   if (type === 'wallet') {
//     if (amount < 1000) return 0; // Free for small amounts
//     if (amount < 5000) return 10;
//     if (amount < 50000) return 25;
//     return 50;
//   }
  
//   // Bank transfers
//   if (type === 'bank') {
//     if (amount < 5000) return 35;
//     if (amount < 50000) return 50;
//     return 100;
//   }
  
//   return 25; // Default fee
// };

module.exports = {
  sendSMS,
  isValidNigerianPhone,
  normalizeNigerianPhone,
  generateOTP,
  hashPin,
  isValidPin,
  formatNaira,
  generateRateLimitKey,
  logSMSInteraction,
//   calculateTransactionFee
};