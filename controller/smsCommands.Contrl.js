const UserModel = require("../model/User.Model")


//handle sms command processor
const HandleNewCommand = async(phoneNumber, message) => {
    try {
        const user = await UserModel.findOne({phoneNumber, isPhoneVerified:true});

        if(!user){
            // return await 
        }
    } catch (error) {
        
    }
}