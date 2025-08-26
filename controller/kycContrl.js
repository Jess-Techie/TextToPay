// services/kycService.js
const { default: axios } = require("axios");
const crypto = require("crypto");
const KycverifModel = require("../model/Kycverif.Model");
const UserModel = require("../model/User.Model");
const { decrypt, encrypt } = require("../utils/random.Utils");


// ------------------ MONO API CONFIG ------------------
const monoAPI = axios.create({
  baseURL: "https://api.withmono.com/v2",
  headers: {
    "mono-sec-key": `${process.env.Mono_secret_key}`,
    "Content-Type": "application/json",
  },
});

// ------------------ BVN VERIFIER ------------------
const verifyBVNWithMono = async (bvn) => {
    try {
      const response = await monoAPI.post("/lookup/bvn", {
        bvn
      });
      
      if (response.data?.status === "successful") {
        const data = response.data.data;
        return {
          isValid: true,
          // bvn,
          fullName: `${data.first_name} ${data.middle_name || ""} ${data.last_name}`.trim(),
          phoneNumber: data.phone_number,
          dateOfBirth: data.date_of_birth,
          gender: data.gender,
          email:
            data.email ||
            `${data.first_name}.${data.last_name}@texttopay.com`,
          provider: "mono",
        };
      }
      throw new Error(response.data?.message || "BVN verification failed");
    } catch (err) {
      throw new Error(err.response?.data?.message || err.message);
    }
};

// ------------------ CHECK IF BVN EXISTS ------------------
const checkBVNExists = async (bvn) => {
    // Get all KYC records and decrypt each to check for duplicates
    const allKYCRecords = await KycverifModel.find({});
    
    for (const record of allKYCRecords) {
      try {
        const decryptedBVN = decrypt(record.idNumber);
        if (decryptedBVN === bvn) {
          return true; // BVN already exists
        }
      } catch (error) {
        console.warn(`Failed to decrypt BVN for record ${record._id}:`, error.message);
        continue;
      }
    }
    return false; // BVN doesn't exist
};

// ------------------ MAIN VERIFY + SAVE ------------------
const verifyAndSaveIdentity = async (userId, identityType, identityNumber) => {
  // Check if BVN already exists
    if (identityType === "bvn") {
      const bvnExists = await checkBVNExists(identityNumber);
      if (bvnExists) {
        throw new Error("This BVN is already registered with another account.");
      }
    }

    let verificationResult;
    if (identityType === "bvn") {
      verificationResult = await verifyBVNWithMono(identityNumber);
    } else {
      throw new Error("Unsupported identity type");
    }

    if (!verificationResult.isValid) {
      throw new Error("Identity verification failed");
    }

    // Encrypt the ID number before storing
    const encryptedIdNumber = encrypt(identityNumber);

    // Save in KYC collection
    const kycRecord = await KycverifModel.findOneAndUpdate(
      { userid: userId },
      {
        userid: userId,
        idType: identityType,
        idNumber: encryptedIdNumber, // Store encrypted
        verificationProvider: verificationResult.provider || 'mono',
        verificationDate: new Date(),
        verificationStatus: 'verified'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Update User collection
    await UserModel.findByIdAndUpdate(
      userId,
      {
        fullName: verificationResult.fullName,
        // phoneNumber: verificationResult.phoneNumber,
        email: verificationResult.email,
        isKYCVerified: true,
      },
      { new: true }
    );

    return { verificationResult, kycRecord };
};


const isValidBVN = (bvn) => {
  return /^\d{11}$/.test(bvn);
};

// Validate NIN format  
const isValidNIN = (nin) => {
  return /^\d{11}$/.test(nin);
};

// Extract name similarity score (for verification)
const calculateNameSimilarity = (name1, name2) => {
  const normalize = (name) => name.toLowerCase().trim().replace(/\s+/g, ' ');
  const n1 = normalize(name1);
  const n2 = normalize(name2);
  
  // Simple similarity check
  const words1 = n1.split(' ');
  const words2 = n2.split(' ');
  
  let matches = 0;
  words1.forEach(word1 => {
    if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
      matches++;
    }
  });
  
  return matches / Math.max(words1.length, words2.length);
};

module.exports = {
 verifyAndSaveIdentity,
  verifyBVNWithMono,
  checkBVNExists,
  // verifyIdentity,
  isValidBVN,
  isValidNIN,
  calculateNameSimilarity
};