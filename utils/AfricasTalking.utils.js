const AfricasTalking = require('africastalking')({
  apiKey: process.env.africasTalkingApiKey,
  username: process.env.africasTalkingApiUsername
});

const sms = AfricasTalking.SMS;
const ussd = AfricasTalking.USSD;
const airtime = AfricasTalking.AIRTIME;

module.exports = {
  sms,
  ussd,
  airtime,
  AfricasTalking
};