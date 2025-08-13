const { default: mongoose } = require("mongoose")



const DBConnection = async() => {
    try {
        const dbconn = await mongoose.connect(process.env.databaseConn);
        console.log("database connection establish");
    } catch (error) {
        console.log(error);
        process.exit(1);
    }
}

module.exports = DBConnection;