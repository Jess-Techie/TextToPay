const UserModel = require('../model/User.Model');
const OtpModel = require('../model/Otp.Model');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sendSMS, normalizeNigerianPhone, hashPin, generateOTP, isValidPin, isValidNigerianPhone } = require('./bankingAndSmsUtils.Contrl');
const { checkBVNExists, verifyBVNWithMono, verifyAndSaveIdentity } = require('./kycContrl');
const { createVirtualAccount } = require('./virtualAcctAndPaymentUtils.Contrl');
const { encrypt } = require('../utils/random.Utils');
const KycverifModel = require('../model/Kycverif.Model');

// Register new user via SMS
const initiateRegistration = async (phoneNumber, message) => {
    try {
      const normalizedPhone = normalizeNigerianPhone(phoneNumber);
      
      if (!isValidNigerianPhone(normalizedPhone)) {
        return await sendSMS(phoneNumber, "Invalid phone number format. Please use a valid Nigerian number.");
      }

      // Check if user already exists
      const existingUser = await UserModel.findOne({ phoneNumber: normalizedPhone });
      if (existingUser) {
        return await sendSMS(phoneNumber, "You're already registered! Text HELP for commands or dial *347*456#");
      }

      // Send registration instructions
      const welcomeMessage = `Welcome to TextToPay!

        To complete registration, reply with:
        REG [BVN] [4-digit PIN]

        Example:
        REG 12345678901 1234

        Your BVN is safe & secure with us.`;

      return await sendSMS(phoneNumber, welcomeMessage);

    } catch (error) {
      console.error('Registration initiation error:', error);
      return await sendSMS(phoneNumber, "System error. Please try again later.");
    }
};

// Complete user registration

const completeRegistration = async (phoneNumber, message) => {
    try {
      // Parse format: REG 12345678901 1234
      const regMatch = message.match(/^REG\s+(\d{11})\s+(\d{4})$/i);
      if (!regMatch) {
        return await sendSMS(phoneNumber, ` Invalid format. Use:
          REG [BVN] [PIN]
          Example:
          REG 12345678901 1234`
        );
      }

      const [, bvn, pin] = regMatch;
      const normalizedPhone = normalizeNigerianPhone(phoneNumber);

      // Validate inputs
      if (!/^\d{11}$/.test(bvn)) {
        return await sendSMS(phoneNumber, " BVN must be exactly 11 digits.");
      }
      if (!/^\d{4}$/.test(pin)) {
        return await sendSMS(phoneNumber, " PIN must be exactly 4 digits.");
      }

      // Check for existing user with same phone number
      const existingUser = await UserModel.findOne({ phoneNumber: normalizedPhone });
      if (existingUser) {
        return await sendSMS(phoneNumber, " This phone number is already registered.");
      }

      // Check for existing BVN in KYC records
      const bvnExists = await checkBVNExists(bvn);
      if (bvnExists) {
        return await sendSMS(phoneNumber, " This BVN is already registered with another account.");
      }

      // Step 1: Verify BVN first to get user details (try Mono first, fallback to Raven)
      let bvnVerification;
      // try {
      //   bvnVerification = await verifyBVNWithMono(bvn);
      // } catch (error) {
      //   console.log('Mono BVN failed, ', error.message);
      //     return await sendSMS(phoneNumber, " BVN verification failed. Please check your BVN and try again.");
      // }
      
      // Add this right after the BVN validation, before the Mono call
      if (process.env.NODE_ENV === 'development' || bvn === '12345678903') {
        // Mock BVN verification for testing
        bvnVerification = {
          isValid: true,
          fullName: 'Jessy Eli',
          email: 'jessy@gmail.com',
          phoneNumber: phoneNumber,
          provider: 'test'
        };
        console.log('Using test BVN verification');
      } else {
        // Real Mono verification
        try {
          bvnVerification = await verifyBVNWithMono(bvn);
        } catch (error) {
          console.log('Mono BVN failed, ', error.message);
          return await sendSMS(phoneNumber, " BVN verification failed. Please check your BVN and try again.");
        }
      }

      if (!bvnVerification.isValid) {
        return await sendSMS(phoneNumber, ` BVN verification failed: ${bvnVerification.error}`);
      }

      // Step 2: Hash PIN
      const hashedPin = await hashPin(pin);

      // Step 3: Create user with BVN verified details
      const user = await UserModel.create({
        phoneNumber: normalizedPhone,
        fullName: bvnVerification.fullName.trim(), // Get from BVN verification
        email: bvnVerification.email || `${bvnVerification.fullName.replace(/\s+/g, '').toLowerCase()}@texttopay.com`,
        pin: hashedPin,
        isKYCVerified: true,
        walletBalance: 0,
        status: 'active'
      });

      // // Save KYC data securely (hashed only) this is the actual code
      // try {
      //   await verifyAndSaveIdentity(
      //     user._id,
      //     "bvn",
      //     bvn
      //   );
      // } catch (error) {
      //   // If KYC save fails, delete the created user
      //   await UserModel.findByIdAndDelete(user._id);
      //   console.error("KYC save failed:", error.message);
      //   return await sendSMS(phoneNumber, " Registration failed. Please try again later.");
      // }
      
      // Save KYC data manually for testing (since verifyAndSaveIdentity is commented out)
        try {
          // Encrypt and save KYC record manually
          const encryptedBVN = encrypt(bvn);

          await KycverifModel.findOneAndUpdate(
            { userid: user._id },
            {
              userid: user._id,
              idType: 'bvn',
              idNumber: encryptedBVN,
              verificationProvider: 'test',
              verificationDate: new Date(),
              verificationStatus: 'verified'
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          
          console.log('KYC data saved manually for testing');
        } catch (error) {
          // If KYC save fails, delete the created user
          await UserModel.findByIdAndDelete(user._id);
          console.error("KYC save failed:", error.message);
          return await sendSMS(phoneNumber, " Registration failed. Please try again later.");
        }

      //  Create Korapay virtual account
      try {
        const virtualAccount = await createVirtualAccount({
          userId: user._id,
          fullName: user.fullName,
          phoneNumber: user.phoneNumber,
          // Don't pass actual BVN to external services
        });

        if (virtualAccount.success) {
          await UserModel.updateOne(
            { _id: user._id },
            {
              virtualAccount: virtualAccount.data,
              status: 'active'
            }
          );
        }
      } catch (error) {
        console.error('Virtual account creation failed:', error);
        // Continue without virtual account for now
      }

      // Step 6: Generate phone verification OTP
      const otp = generateOTP();
      await OtpModel.create({
        userId: user._id, 
        phoneNumber: normalizedPhone,
        otp,
        purpose: 'phone_verification',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
      });

      const successMessage = ` Registration successful!
        📱 Verification code: ${otp}
        ⏰ Valid for 5 minutes

        Reply: VERIFY ${otp}

        Welcome to TextToPay, ${bvnVerification.fullName.split(' ')[0]}! 🎉`;

      return await sendSMS(phoneNumber, successMessage);

    } catch (error) {
      console.error('Registration completion error:', error);
      return await sendSMS(phoneNumber, " Registration failed. Please try again.");
    }
};


// Verify phone number
const verifyPhone = async (phoneNumber, message) => {
    try {
      // Parse: VERIFY 1234
      const verifyMatch = message.match(/^VERIFY\s+(\d{4})$/i);
      
      if (!verifyMatch) {
        return await sendSMS(phoneNumber, " Use format: VERIFY [4-digit code]");
      }

      const [, otp] = verifyMatch;
      const normalizedPhone = normalizeNigerianPhone(phoneNumber);

      const user = await UserModel.findOne({ phoneNumber: normalizedPhone });
      if (!user) {
        return await sendSMS(phoneNumber, " User not found. Please register first.");
      }

      const otpRecord = await OtpModel.findOne({
        userId: user._id,
        phoneNumber: normalizedPhone,
        otp,
        purpose: 'phone_verification',
        verified: false,
        expiresAt: { $gt: new Date() }
      });

      if (!otpRecord) {
        return await sendSMS(phoneNumber, " Invalid or expired verification code. Text resend || code to get a new code.");
      }

      // Mark OTP as verified
      await OtpModel.updateOne({ _id: otpRecord._id }, { verified: true });

      // Mark user phone as verified and activate
      await UserModel.updateOne(
        { phoneNumber: normalizedPhone },
        { 
          isPhoneVerified: true,
          status: 'active'
        }
      );

      await UserModel.findOne({ phoneNumber: normalizedPhone });

      const welcomeMessage = ` Phone verified successfully!

      💳 Your TextToPay wallet is ready
      📱 ${normalizedPhone}
      💰 Balance: ₦0.00
      ${user.virtualAccount ? `🏦 Account: ${user.virtualAccount.accountNumber}` : ''}

      💡 Commands:
      • BAL - Check balance  
      • PAY 1000 TO 08123456789 - Send money
      • BUY 200 FOR 08123456789 - Buy airtime
      • HELP - All commands

      Ready to send money? 🚀`;

      return await sendSMS(phoneNumber, welcomeMessage);

    } catch (error) {
      console.error('Phone verification error:', error);
      return await sendSMS(phoneNumber, " Verification failed. Please try again.");
    }
};

// Resend verification OTP
const resendOTP = async (phoneNumber) => {
    try {
      const normalizedPhone = normalizeNigerianPhone(phoneNumber);
      
      const user = await UserModel.findOne({ phoneNumber: normalizedPhone });
      if (!user) {
        return await sendSMS(phoneNumber, " User not found. Text START to register.");
      }

      if (user.isPhoneVerified) {
        return await sendSMS(phoneNumber, " Your phone is already verified! Text HELP for commands.");
      }

      // Generate new OTP
      const otp = generateOTP();
      
      // Delete old OTPs
      await OtpModel.deleteMany({
        phoneNumber: normalizedPhone,
        purpose: 'phone_verification'
      });

      // Create new OTP
      await OtpModel.create({
        userId: user._id,
        phoneNumber: normalizedPhone,
        otp,
        purpose: 'phone_verification',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      });

      return await sendSMS(phoneNumber, ` New verification code: ${otp}
      ⏰ Valid for 5 minutes
      Reply: VERIFY ${otp}`);

    } catch (error) {
      console.error('OTP resend error:', error);
      return await sendSMS(phoneNumber, " Failed to resend code. Please try again.");
    }
};

  // Update user PIN
const updatePin = async (phoneNumber, currentPin, newPin) => {
    try {
      
      if (!isValidPin(newPin)) {
        return await sendSMS(phoneNumber, " New PIN must be 4-6 digits.");
      }
      

      const user = await UserModel.findOne({ phoneNumber });
      if (!user) {
        return await sendSMS(phoneNumber, " User not found.");
      }

      const isCurrentPinValid = await bcrypt.compare(currentPin, user.pin);
      if (!isCurrentPinValid) {
        return await sendSMS(phoneNumber, " Current PIN is incorrect.");
      }
      

      const hashedNewPin = await hashPin(newPin);
      await UserModel.updateOne(
        { _id: user._id },
        { pin: hashedNewPin, pinUpdatedAt: new Date() }
      );

      // Send confirmation SMS
      const confirmMessage = `Your TextToPay PIN has been updated successfully on ${new Date().toLocaleString()}. 

        If this wasn't you, contact support immediately.`;
      
      return await sendSMS(user.phoneNumber, confirmMessage);
     
    } catch (error) {
      console.error('Update PIN error:', error);
      return await sendSMS(phoneNumber, " Failed to update PIN.");
    }
  };

  // Login with PIN (for web/app)
const loginUser = async (phoneNumber, pin) => {
      try {
        if (!phoneNumber || !pin) {
          return await sendSMS(phoneNumber, " Phone number and PIN are required.");
        }
        if (!isValidPin(pin)) {
          return await sendSMS(phoneNumber, " PIN must be 4-6 digits.");
        }

      const normalizedPhone = normalizeNigerianPhone(phoneNumber);
      
      const user = await UserModel.findOne({ 
        phoneNumber: normalizedPhone,
        isPhoneVerified: true,
        status: 'active'
      });

      if (!user) {
        return await sendSMS(phoneNumber, " User not found or not verified.");
      }

      const isValidPin = await bcrypt.compare(pin, user.pin);
      
      if (!isValidPin) {
        return await sendSMS(phoneNumber, " Invalid PIN.");
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user._id, 
          phoneNumber: user.phoneNumber 
        },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      return {
        success: true,
        token,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          fullName: user.fullName,
          walletBalance: user.walletBalance,
          virtualAccount: user.virtualAccount
        }
      };

    } catch (error) {
      console.error('Login error:', error);
      return await sendSMS(phoneNumber, " Login failed.");
    }
};

// Get user profile
const getUserProfile = async (userId) => {
    try {
      const user = await UserModel.findById(userId).select('-pin -bvn');
      if (!user) {
        return await sendSMS(phoneNumber, " User not found.");
      }

      return {
        success: true,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          fullName: user.fullName,
          walletBalance: user.walletBalance,
          virtualAccount: user.virtualAccount
        }
      };

    } catch (error) {
      console.error('Profile fetch error:', error);
      return await sendSMS(phoneNumber, " Failed to fetch profile.");
    }
};
 
module.exports = {
  initiateRegistration,
  completeRegistration,
  verifyPhone,
  updatePin,
  resendOTP,
  loginUser,
  getUserProfile
};