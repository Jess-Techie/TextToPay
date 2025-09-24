const smsSessionModel = require("../model/smsSession.Model");
const UserModel = require("../model/User.Model");
const bcrypt = require('bcryptjs');
const { processPaymentTransaction } = require("./smsCommands.Contrl");

const handleUSSDRequest = async (sessionId, serviceCode, phoneNumber, text) => {
    try {
        const input = text.split('*');
        const level = input.length;
        
        console.log('USSD Level:', level, 'Input:', input);
        
        if (level === 1 && input[0] === '') {
            // First interaction - show TextToPay option
            return `CON Welcome to TextToPay USSD Service
1. TextToPay Transactions
2. Other Services`;
        }
        
        if (level === 2 && input[1] === '1') {
            return `CON TextToPay:
Enter your session ID:`;
        }
        
        if (level === 3 && input[1] === '1') {
            const sessionCode = input[2];
            
            // Find active payment session
            const session = await smsSessionModel.findOne({
                sessionId: { $regex: sessionCode, $options: 'i' },
                phoneNumber,
                currentStep: 'awaiting_ussd_pin',
                expiresAt: { $gt: new Date() }
            });
            
            if (!session) {
                return `END Session not found or expired.
Please start a new transaction via SMS.`;
            }
            
            return `CON Enter your 4-digit PIN to complete payment of ₦${session.transactionData?.totalAmount}:`;
        }
        
        if (level === 4 && input[1] === '1') {
            const sessionCode = input[2];
            const pin = input[3];
            
            return await processUSSDPin(phoneNumber, sessionCode, pin);
        }
        
        // Handle other menu options
        if (level === 2 && input[1] === '2') {
            return `CON Other Services:
1. Check Balance
2. Transaction History
0. Back to Main Menu`;
        }
        
        if (level === 3 && input[1] === '2') {
            const subOption = input[2];
            if (subOption === '0') {
                return `CON Welcome to TextToPay USSD Service
1. TextToPay Transactions
2. Other Services`;
            }
            return 'END Service coming soon.';
        }
        
        return 'END Invalid selection.';
        
    } catch (error) {
        console.error('USSD error:', error);
        return 'END System error. Please try again.';
    }
};

const processUSSDPin = async (phoneNumber, sessionCode, pin) => {
    try {
        if (!/^\d{4}$/.test(pin)) {
            return 'END Invalid PIN format. Must be 4 digits.';
        }
        
        const session = await smsSessionModel.findOne({
            sessionId: { $regex: sessionCode, $options: 'i' },
            phoneNumber,
            currentStep: 'awaiting_ussd_pin',
            expiresAt: { $gt: new Date() }
        });
        
        if (!session) {
            return 'END Session expired.';
        }
        
        const user = await UserModel.findById(session.userId);
        const isValidPin = await bcrypt.compare(pin, user.pin);
        
        if (!isValidPin) {
            // Increment attempts
            await smsSessionModel.updateOne(
                { _id: session._id },
                { $inc: { 'transactionData.pinAttempts': 1 } }
            );
            
            const attempts = (session.transactionData.pinAttempts || 0) + 1;
            
            if (attempts >= 3) {
                await smsSessionModel.deleteOne({ _id: session._id });
                return 'END Too many failed attempts. Transaction cancelled.';
            }
            
            return `END Incorrect PIN (${attempts}/3 attempts).
Try again by dialing the USSD code.`;
        }
        
        // Process transaction asynchronously
        setImmediate(() => {
            processPaymentTransaction(user, session);
        });
        
        return `END PIN accepted.
Processing your payment of ₦${session.transactionData.totalAmount}.
You'll receive SMS confirmation shortly.`;
        
    } catch (error) {
        console.error('USSD PIN processing error:', error);
        return 'END Processing failed. Please try again.';
    }
};

// Express route handler
// const handleUSSDWebhook = async (req, res) => {
//     try {
//         const { sessionId, serviceCode, phoneNumber, text } = req.body;
        
//         console.log('📱 USSD Webhook Received:', { sessionId, phoneNumber, text });
        
//         const result = await handleUSSDRequest(sessionId, serviceCode, phoneNumber, text);
        
//         console.log('📱 USSD Response:', result);
        
//         res.set('Content-Type', 'text/plain');
//         res.send(result);
        
//     } catch (error) {
//         console.error('USSD webhook error:', error);
//         res.set('Content-Type', 'text/plain');
//         res.send('END System error occurred.');
//     }
// };

module.exports = { 
    handleUSSDRequest, 
    processUSSDPin,
    // handleUSSDWebhook
};





// const smsSessionModel = require("../model/smsSession.Model");
// const UserModel = require("../model/User.Model");
// const bcrypt = require('bcryptjs');
// // const { ussd } = require("./bankingAndSmsUtils.Contrl");
// const { processPaymentTransaction } = require("./smsCommands.Contrl");


// const handleUSSDRequest = async (sessionId, serviceCode, phoneNumber, text) => {
//     try {
//         const input = text.split('*');
//         const level = input.length;
        
//         console.log('USSD Level:', level, 'Input:', input);
        
//         if (level === 1 && input[0] === '') {
//             // First interaction - show TextToPay option
//             return `CON Welcome to TextToPay USSD Service
//                 1. TextToPay Transactions
//                 2. Other Services`;
//         }
        
//         if (level === 2 && input[1] === '1') {
//             return `CON TextToPay:
//             Enter your session ID:`;
//         }
        
//         if (level === 3 && input[1] === '1') {
//             const sessionCode = input[2];
            
//             // Find active payment session
//             const session = await smsSessionModel.findOne({
//                 sessionId: { $regex: sessionCode, $options: 'i' },
//                 phoneNumber,
//                 currentStep: 'awaiting_ussd_pin',
//                 expiresAt: { $gt: new Date() }
//             });
            
//             if (!session) {
//                 return `END Session not found or expired.
//                 Please start a new transaction via SMS.`;
//             }
            
//             return `CON Enter your 4-digit PIN to complete payment of ₦${session.transactionData?.totalAmount}:`;
//         }
        
//         if (level === 4 && input[1] === '1') {
//             const sessionCode = input[2];
//             const pin = input[3];
            
//             return await processUSSDPin(phoneNumber, sessionCode, pin);
//         }
        
//         return 'END Invalid selection.';
        
//     } catch (error) {
//         console.error('USSD error:', error);
//         return 'END System error. Please try again.';
//     }
// };

// const processUSSDPin = async (phoneNumber, sessionCode, pin) => {
//     try {
//         if (!/^\d{4}$/.test(pin)) {
//             return 'END Invalid PIN format. Must be 4 digits.';
//         }
        
//         const session = await smsSessionModel.findOne({
//             sessionId: { $regex: sessionCode, $options: 'i' },
//             phoneNumber,
//             currentStep: 'awaiting_ussd_pin',
//             expiresAt: { $gt: new Date() }
//         });
        
//         if (!session) {
//             return 'END Session expired.';
//         }
        
//         const user = await UserModel.findById(session.userId);
//         const isValidPin = await bcrypt.compare(pin, user.pin);
        
//         if (!isValidPin) {
//             // Increment attempts
//             await smsSessionModel.updateOne(
//                 { _id: session._id },
//                 { $inc: { 'transactionData.pinAttempts': 1 } }
//             );
            
//             const attempts = (session.transactionData.pinAttempts || 0) + 1;
            
//             if (attempts >= 3) {
//                 await smsSessionModel.deleteOne({ _id: session._id });
//                 return 'END Too many failed attempts. Transaction cancelled.';
//             }
            
//             return `END Incorrect PIN (${attempts}/3 attempts).
//             Try again by dialing the USSD code.`;
//         }
        
//         // Process transaction asynchronously
//         setImmediate(() => {
//             processPaymentTransaction(user, session);
//         });
        
//         return `END PIN accepted.
//         Processing your payment of ₦${session.transactionData.totalAmount}.
//         You'll receive SMS confirmation shortly.`;
        
//     } catch (error) {
//         console.error('USSD PIN processing error:', error);
//         return 'END Processing failed. Please try again.';
//     }
// };

// module.exports = { 
//     handleUSSDRequest, 
//     processUSSDPin
// };


