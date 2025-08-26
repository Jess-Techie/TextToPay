const express = require('express');
require('dotenv').config();
const DBConnection = require('./config/dbConnection');
const morgan = require('morgan');
// const { apiRoutes } = require('./routes/mainRoute');
const app = express();


const port = process.env.PORT || 3000
DBConnection();

//middleware
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.get('/', (req, res) => res.send('Hello Welcome To Text To Pay!'));

// Use API routes with /api prefix
const apiRoutes = require('./routes/mainRoute');
app.use('/api', apiRoutes);


// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});


app.listen(port, () => console.log(` app listening on port ${port}!`));