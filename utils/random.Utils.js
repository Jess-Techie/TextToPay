const crypto = require('crypto');
const KycverifModel = require('../model/Kycverif.Model');

// ------------------ ENCRYPTION UTILITIES ------------------
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

// Get encryption key from environment
// const getEncryptionKey = () => {
//     if (!process.env.BVN_ENCRYPTION_KEY) {
//         console.warn('BVN_ENCRYPTION_KEY not found in environment. Using temporary key.');
//         return crypto.randomBytes(KEY_LENGTH);
//     }
//     return Buffer.from(process.env.BVN_ENCRYPTION_KEY, 'hex');
// };
const getEncryptionKey = () => {

    // console.log('BVN_ENCRYPTION_KEY from env:', process.env.BVN_ENCRYPTION_KEY); // Add this line

    if (!process.env.BVN_ENCRYPTION_KEY) {
        console.warn('BVN_ENCRYPTION_KEY not found in environment. Using temporary key.');
        return crypto.randomBytes(KEY_LENGTH);
    }
    
    const key = Buffer.from(process.env.BVN_ENCRYPTION_KEY, 'hex');
    
    if (key.length !== KEY_LENGTH) {
        throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }
    
    return key;
};

const encrypt = (text) => {
    try {
        // const key = getEncryptionKey();
        // const iv = crypto.randomBytes(IV_LENGTH);
        
        const key = getEncryptionKey();
        // console.log('Key length:', key.length, 'bytes'); // Should show 32
        
        const iv = crypto.randomBytes(IV_LENGTH);
        // console.log('IV length:', iv.length, 'bytes'); // Should show 16

        // Use createCipheriv with 'aes-256-gcm' algorithm
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const tag = cipher.getAuthTag();
        
        return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
    } catch (error) {
        throw new Error('Encryption failed: ' + error.message);
    }
};

const decrypt = (encryptedText) => {
    try {
        const key = getEncryptionKey();
        
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }
        
        const iv = Buffer.from(parts[0], 'hex');
        const tag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        
        // Use createDecipheriv with 'aes-256-gcm' algorithm
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        throw new Error('Decryption failed: ' + error.message);
    }
};

const getDecryptedBVN = async (userId) => {
    const kycRecord = await KycverifModel.findOne({ userid: userId });
    
    if (!kycRecord || !kycRecord.idNumber) {
        throw new Error('No BVN found for user');
    }
    
    return decrypt(kycRecord.idNumber);
};

// Generate encryption key (for setup)
const generateEncryptionKey = () => {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
};
// console.log('Generated encryption key:', generateEncryptionKey());

module.exports = {
    encrypt,    
    decrypt,
    getDecryptedBVN,
    generateEncryptionKey
};