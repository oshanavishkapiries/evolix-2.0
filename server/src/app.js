require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const logger = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth.routes');
const seriesRoutes = require('./routes/series.routes');
const episodeRoutes = require('./routes/episode.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/series', seriesRoutes);
app.use('/api/episodes', episodeRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

module.exports = app; 