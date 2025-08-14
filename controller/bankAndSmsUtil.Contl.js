const { default: axios } = require("axios");




const nigerianBanksCache = null;
let banksCacheExpiry = null;


// Korapay API configuration
const korapayAPI = axios.create({
    baseURL: 'https://api.korapay.com/merchant/api/v1',
    headers:{
        'Authorization': `Bearer ${process.env.kora_key}`,
        "Content-Type": 'application/json'
    }
});

const fetchNigerianBanks = async(forceRefresh = false) => {
    try {

    // Check cache first (refresh daily)
    const now = new Date();
    if (!forceRefresh && nigerianBanksCache && banksCacheExpiry && now < banksCacheExpiry) {
      return nigerianBanksCache;
    }

    const response = await korapayAPI.get('/misc/banks?countryCode=NG')

    if (response.data.status && response.data.data) {
      const banks = response.data.data.map(bank => ({
        name: bank.name,
        code: bank.code,
        slug: bank.slug || bank.code,
        shortCode: generateShortCode(bank.name)
      }));

        // Cache for 24 hours
      nigerianBanksCache = banks;
      banksCacheExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      
      console.log(`Fetched ${banks.length} Nigerian banks`);
      return banks;
    }
    
    throw new Error('Invalid response from Korapay banks API');

    } catch (error) {
        console.error('Failed to fetch banks from Korapay:', error.message);
        // Return fallback banks if API fails
        return getFallbackBanks();
    }
};

// Generate short codes for banks (GTB, UBA, etc.)
const generateShortCode = (bankName) => {
  const name = bankName.toUpperCase();
  
  // Common short codes mapping
  const shortCodes = {
    'GUARANTY TRUST BANK': 'GTB',
    'UNITED BANK FOR AFRICA': 'UBA',
    'ACCESS BANK': 'ACCESS',
    'ZENITH BANK': 'ZENITH',
    'FIRST CITY MONUMENT BANK': 'FCMB',
    'UNION BANK': 'UNION',
    'STERLING BANK': 'STERLING',
    'STANBIC IBTC BANK': 'STANBIC',
    'FIDELITY BANK': 'FIDELITY',
    'POLARIS BANK': 'POLARIS',
    'WEMA BANK': 'WEMA',
    'UNITY BANK': 'UNITY',
    'KEYSTONE BANK': 'KEYSTONE',
    'JAIZ BANK': 'JAIZ',
    'PROVIDUS BANK': 'PROVIDUS',
    'FIRST BANK': 'FBN',
    'ECOBANK': 'ECO'
  };

  // Find exact match first
  for (const [fullName, shortCode] of Object.entries(shortCodes)) {
    if (name.includes(fullName)) {
      return shortCode;
    }
  }
  
  // Generate from first letters of significant words
  const words = name.split(' ').filter(word => 
    !['BANK', 'PLC', 'LIMITED', 'LTD', 'OF', 'FOR', 'THE', 'AND'].includes(word)
  );
  
  return words.map(word => word[0]).join('').substring(0, 4);
};

// Fallback banks list (in case API fails)
const getFallbackBanks = () => [
  { name: 'Guaranty Trust Bank', code: '058', shortCode: 'GTB' },
  { name: 'United Bank for Africa', code: '033', shortCode: 'UBA' },
  { name: 'Access Bank', code: '044', shortCode: 'ACCESS' },
  { name: 'Zenith Bank', code: '057', shortCode: 'ZENITH' },
  { name: 'First City Monument Bank', code: '214', shortCode: 'FCMB' },
  { name: 'First Bank of Nigeria', code: '011', shortCode: 'FBN' },
  { name: 'Union Bank of Nigeria', code: '032', shortCode: 'UNION' },
  { name: 'Sterling Bank', code: '232', shortCode: 'STERLING' },
  { name: 'Stanbic IBTC Bank', code: '221', shortCode: 'STANBIC' },
  { name: 'Fidelity Bank', code: '070', shortCode: 'FIDELITY' },
  { name: 'Polaris Bank', code: '076', shortCode: 'POLARIS' },
  { name: 'Wema Bank', code: '035', shortCode: 'WEMA' },
  { name: 'Unity Bank', code: '215', shortCode: 'UNITY' },
  { name: 'Keystone Bank', code: '082', shortCode: 'KEYSTONE' },
  { name: 'Jaiz Bank', code: '301', shortCode: 'JAIZ' },
  { name: 'Providus Bank', code: '101', shortCode: 'PROVIDUS' },
  { name: 'Ecobank Nigeria', code: '050', shortCode: 'ECO' }
];

// Resolve bank by code or short code
const resolveNigerianBank = async (bankIdentifier) => {
  try {
    const banks = await fetchNigerianBanks();
    const upperIdentifier = bankIdentifier.toUpperCase();
    
    // Search by short code, code, or name
    const bank = banks.find(b => 
      b.shortCode === upperIdentifier ||
      b.code === bankIdentifier ||
      b.name.toUpperCase().includes(upperIdentifier)
    );
    
    return bank || null;
    
  } catch (error) {
    console.error('Bank resolution error:', error);
    return null;
  }
};

// Get all Nigerian banks
const getNigerianBanksList = async () => {
  try {
    return await fetchNigerianBanks();
  } catch (error) {
    console.error('Error fetching banks list:', error);
    return getFallbackBanks();
  }
};

// Generate transaction ID
const generateTransactionId = () => {
  const timestamp = Date.now().toString(36);
  const randomStr = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TXN${timestamp}${randomStr}`;
};

const sendSMS = async(phoneNumber, message) => {
  try {

    const credentials = {
      apiKey: process.env.africasTalkingApiKey,
      username: process.env.africasTalkingApiUsername
    }

    const AfricasTalking = require('africastalking')(credentials);
    const sms = AfricasTalking.SMS;

    const Options = {
      to: phoneNumber,
      message: message,
      from: 'TextToPay App'
    }

    const result = await sms.send(Options);
    console.log('SMS sent', result);

    return {
    success: true,
    messageId: result.SMSMessageData.Recipients[0].messageId,
    status: result.SMSMessageData.Recipients[0].status
    };
  } catch (error) {
    console.error('SMS sending failed:', error);
    return { success: false, error: error.message };
  }
};

//verify nigerian BVN (using Korapay or Mono)
const verifyBVN = async(bvn, firstName, lastName) => {
  try {
    // Using Korapay identity verification
    const response = await korapayAPI.post('/identity/ng/bvn', {
      bvn,
      first_name: firstName,
      last_name: lastName
    });
    
    if (response.data.status && response.data.data) {
      return {
        isValid: response.data.data.validation_status === 'success',
        fullName: response.data.data.full_name,
        phoneNumber: response.data.data.phone_number,
        dateOfBirth: response.data.data.date_of_birth
      };
    }
    
    return { isValid: false, error: 'BVN verification failed' };
  } catch (error) {
    console.error('BVN verification failed:', error);
    return { isValid: false, error: error.message };
  }
};

// Resolve account name using Korapay
const resolveAccountName = async (accountNumber, bankCode) => {
  try {
    const bank = await resolveNigerianBank(bankCode);
    if (!bank) {
      throw new Error('Invalid bank code');
    }
    
    console.log(`🔍 Resolving account: ${accountNumber} at ${bank.name}`);
    
    const response = await korapayAPI.post('/misc/banks/account/resolve', {
      bank: bank.code,
      account: accountNumber
    });
    
    if (response.data.status && response.data.data) {
      return {
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
        bankName: bank.name,
        bankCode: bank.code,
        isValid: true
      };
    }
    
    throw new Error('Account not found');
    
  } catch (error) {
    console.error('Account resolution failed:', error);
    return { 
      isValid: false, 
      error: error.response?.data?.message || error.message 
    };
  }
};

// Process transfer via Korapay
const processKorapayTransfer = async (recipientData, amount, reason, reference) => {
  try {
    console.log(`💸 Processing Korapay transfer: ₦${amount} to ${recipientData.account_name}`);
    
    const response = await korapayAPI.post('/transactions/transfer', {
      reference,
      destination: {
        type: 'bank_account',
        amount: amount * 100, // Convert to kobo
        currency: 'NGN',
        narration: reason || 'TextPay Transfer',
        bank_account: {
          bank: recipientData.bank_code,
          account: recipientData.account_number
        },
        customer: {
          name: recipientData.account_name
        }
      }
    });
    
    if (response.data.status) {
      return {
        success: true,
        reference: response.data.data.reference,
        status: response.data.data.status,
        korapayId: response.data.data.id
      };
    }
    
    throw new Error(response.data.message || 'Transfer failed');
    
  } catch (error) {
    console.error('Korapay transfer failed:', error);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
};

// Initialize payment with Korapay
const initializeKorapayPayment = async (amount, email, reference, metadata = {}) => {
  try {
    const response = await korapayAPI.post('/charges/initialize', {
      amount: amount * 100, // Convert to kobo
      currency: 'NGN',
      email,
      reference,
      redirect_url: process.env.FRONTEND_URL + '/payment/success',
      metadata,
      channels: ['bank_transfer', 'card', 'ussd'],
      notification_url: process.env.API_URL + '/api/webhooks/korapay'
    });
    
    if (response.data.status) {
      return {
        success: true,
        paymentUrl: response.data.data.checkout_url,
        reference: response.data.data.reference
      };
    }
    
    throw new Error(response.data.message || 'Payment initialization failed');
    
  } catch (error) {
    console.error('Korapay payment initialization failed:', error);
    return { 
      success: false, 
      error: error.response?.data?.message || error.message 
    };
  }
};

const isValidNigerianPhone  = async(phone) => {
  const clean = phone.replace(/\D/g, '');

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
}

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

// Verify Korapay webhook signature
const verifyKorapayWebhook = (payload, signature) => {
  try {
    const hash = crypto
      .createHmac('sha256', process.env.KORAPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return hash === signature;
  } catch (error) {
    console.error('❌ Webhook signature verification failed:', error);
    return false;
  }
};

// Get transaction fees
const calculateTransactionFee = (amount, type) => {
  // Internal wallet transfers
  if (type === 'wallet') {
    if (amount < 1000) return 0; // Free for small amounts
    if (amount < 5000) return 10;
    if (amount < 50000) return 25;
    return 50;
  }
  
  // Bank transfers
  if (type === 'bank') {
    if (amount < 5000) return 35;
    if (amount < 50000) return 50;
    return 100;
  }
  
  return 25; // Default fee
};

module.exports = {
  fetchNigerianBanks,
  resolveNigerianBank,
  getNigerianBanksList,
  generateTransactionId,
  sendSMS,
  verifyBVN,
  resolveAccountName,
  processKorapayTransfer,
  initializeKorapayPayment,
  isValidNigerianPhone,
  normalizeNigerianPhone,
  generateOTP,
  hashPin,
  isValidPin,
  formatNaira,
  generateRateLimitKey,
  logSMSInteraction,
  verifyKorapayWebhook,
  calculateTransactionFee
}