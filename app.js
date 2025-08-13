const express = require('express');
require('dotenv').config();
const DBConnection = require('./config/dbConnection');
const morgan = require('morgan');
const app = express();


const port = process.env.PORT || 3000
DBConnection();

//middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.get('/', (req, res) => res.send('Hello World!'));


app.listen(port, () => console.log(` app listening on port ${port}!`))