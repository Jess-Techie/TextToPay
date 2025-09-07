const { default: axios } = require('axios');
const crypto = require('crypto');
const KycverifModel = require('../model/Kycverif.Model');
const { getDecryptedBVN } = require('../utils/random.Utils');

// Korapay API configuration
const korapayAPI = axios.create({
  baseURL: 'https://api.korapay.com/merchant/api/v1',
  timeout: 60000, // Increase timeout
  headers: {
    'Authorization': `Bearer ${process.env.kora_key}`,
    'Content-Type': 'application/json',
  }
});

// Create virtual account for user
const createVirtualAccount = async (userData) => {
  try {
    const { userId, fullName, phoneNumber, bvn } = userData;
    
    console.log(` Creating virtual account for: ${fullName}`);

    // const normalizedPhone = normalizeNigerianPhone(phoneNumber);
          
    // if (!isValidNigerianPhone(normalizedPhone)) {
    //   return await sendSMS(phoneNumber, "Invalid phone number format. Please use a valid Nigerian number.");
    // }
    // Check if user has verified KYC
    const kycRecord = await KycverifModel.findOne({ 
      userid: userId, 
      verificationStatus: 'verified' 
    });
    
    if (!kycRecord) {
      return { 
        success: false, 
        error: "BVN verification not found. Please complete KYC verification first."
      };
    }

    if (!kycRecord.idNumber) {
      return { 
        success: false, 
        error: "BVN data not available. Please re-verify your KYC."
      };
    }

    // Get decrypted BVN for KoraPay
    let plainBVN;
    try {
      plainBVN = await getDecryptedBVN(userId);
    } catch (error) {
      console.error('BVN decryption failed:', error.message);
      return { 
        success: false, 
        error: "Unable to retrieve BVN data. Please contact support."
      };
    }

    const reference = `VA_${Date.now()}_${userId}`;
    
    const response = await korapayAPI.post('/virtual-bank-account', {
      account_name: fullName,
      account_reference: reference,
      permanent: true,
      bank_code: '000', // Wema Bank (commonly used for virtual accounts)
      customer: {
        name: fullName,
        email: `user${userId}@texttopay.app`, // Generate email if not provided
        // phone: phoneNumber
      },
      kyc: {
        bvn: plainBVN, //use decrypted BVN
      }
    });

    if (response.data.status && response.data.data) {
      const accountData = response.data.data;
      
      return {
        success: true,
        data: {
          accountNumber: accountData.account_number,
          accountName: accountData.account_name,
          bankName: accountData.bank_name,
          bankCode: accountData.bank_code,
          reference: accountData.account_reference,
          isActive: accountData.active,
          korapayId: accountData.id
        }
      };
    }

    throw new Error('Failed to create virtual account');

  } catch (error) {
    console.error('Virtual account creation failed:', error.response?.data || error.message);

    // Handle specific error cases
    let errorMessage = 'Unable to create virtual account at this time.';
    
    if (error.response?.data?.message) {
      const apiError = error.response.data.message.toLowerCase();
      
      if (apiError.includes('bvn')) {
        errorMessage = 'BVN verification issue. Please check your BVN details.';
      } else if (apiError.includes('duplicate') || apiError.includes('exists')) {
        errorMessage = 'Virtual account already exists for this user.';
      } else {
        errorMessage = error.response.data.message;
      }
    }
    
    return {
      success: false,
      error: errorMessage
    };
  }
};

// Get virtual account details
const getVirtualAccountDetails = async (accountReference) => {
  try {
    const response = await korapayAPI.get(`/virtual-bank-account/${accountReference}`);
    
    if (response.data.status && response.data.data) {
      return {
        success: true,
        data: response.data.data
      };
    }

    throw new Error('Virtual account not found');

  } catch (error) {
    console.error('Failed to fetch virtual account:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
};

// Process bank transfer via Korapay
const processBankTransfer = async (transferData) => {
  try {
    const { recipientBank, recipientAccount, amount, narration, reference, senderName } = transferData;
    
    console.log(`💸 Processing bank transfer: ₦${amount} to ${recipientAccount}`);

    // Handle test accounts - simulate successful transfer
    if (recipientAccount.startsWith('0000') || recipientAccount === '1234567890') {
      console.log('🧪 Simulating test transfer');
      return {
        success: true,
        data: {
          reference: reference,
          status: 'success',
          korapayId: `TEST_${Date.now()}`,
          fee: 50,
          amount: amount
        }
      };
    }

    //regular Api call for reall account
    const response = await korapayAPI.post('/transactions/transfer', {
      reference,
      destination: {
        type: 'bank_account',
        amount: amount * 100, // Convert to kobo
        currency: 'NGN',
        narration: narration || 'TextToPay Transfer',
        bank_account: {
          bank: recipientBank,
          account: recipientAccount
        },
        customer: {
          name: senderName
        }
      }
    });

    if (response.data.status && response.data.data) {
      return {
        success: true,
        data: {
          reference: response.data.data.reference,
          status: response.data.data.status,
          korapayId: response.data.data.id,
          fee: response.data.data.fee / 100, // Convert back from kobo
          amount: response.data.data.amount / 100
        }
      };
    }

    throw new Error(response.data.message || 'Transfer failed');

  } catch (error) {
    console.error('Bank transfer failed:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
};

// Resolve account name
const resolveAccountName = async (accountNumber, bankCode) => {
  try {
    console.log(`🔍 Resolving account: ${accountNumber} at bank ${bankCode}`);

    const response = await korapayAPI.post('/misc/banks/account/resolve', {
      bank: bankCode,
      account: accountNumber
    });

    if (response.data.status && response.data.data) {
      return {
        success: true,
        data: {
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number,
          bankCode: bankCode
        }
      };
    }

    throw new Error('Account not found');

  } catch (error) {
    console.error('Account resolution failed:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
};

// Get list of Nigerian banks
const getNigerianBanks = async () => {
  try {
    const response = await korapayAPI.get('/misc/banks?countryCode=NG');
    
    if (response.data.status && response.data.data) {
      const banks = response.data.data.map(bank => ({
        name: bank.name,
        code: bank.code,
        shortCode: generateBankShortCode(bank.name)
      }));

      return {
        success: true,
        data: banks
      };
    }

    throw new Error('Failed to fetch banks');

  } catch (error) {
    console.error('Failed to fetch banks:', error);
    return {
      success: false,
      data: getFallbackBanks()
    };
  }
};

// Generate bank short codes
const generateBankShortCode = (bankName) => {
  const name = bankName.toUpperCase();
  
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
  
  // Generate from first letters
  const words = name.split(' ').filter(word => 
    !['BANK', 'PLC', 'LIMITED', 'LTD', 'OF', 'FOR', 'THE', 'AND'].includes(word)
  );
  
  return words.map(word => word[0]).join('').substring(0, 4);
};

// Fallback banks list
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

// Resolve bank by code or shortcode
const resolveBankByCode = async (bankIdentifier) => {
  try {
    const banks = await getNigerianBanks();
    const upperIdentifier = bankIdentifier.toUpperCase();
    
    const bank = banks.data.find(b => 
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

// Calculate transaction fees
const calculateTransactionFee = (amount, type = 'bank') => {
  if (type === 'wallet') {
    // Internal wallet transfers
    if (amount < 1000) return 0; // Free for small amounts
    if (amount < 5000) return 10;
    if (amount < 50000) return 25;
    return 50;
  }
  
  // Bank transfers
  if (amount < 5000) return 35;
  if (amount < 50000) return 50;
  return 100;
};

// Verify Korapay webhook signature
const verifyWebhookSignature = (payload, signature) => {
  try {
    const hash = crypto
      .createHmac('sha256', process.env.KORAPAY_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return hash === signature;
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return false;
  }
};

// Generate transaction reference
const generateTransactionReference = (prefix = 'TXN') => {
  const timestamp = Date.now().toString(36);
  const randomStr = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}_${timestamp}_${randomStr}`;
};

module.exports = {
  createVirtualAccount,
  getVirtualAccountDetails,
  processBankTransfer,
  resolveAccountName,
  getNigerianBanks,
  resolveBankByCode,
  generateBankShortCode,
  getFallbackBanks,
  calculateTransactionFee,
  verifyWebhookSignature,
  generateTransactionReference
};