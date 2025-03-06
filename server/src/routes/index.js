const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const seriesRoutes = require('./series.routes');
const episodeRoutes = require('./episode.routes');

// Mount all routes under /api/v1
router.use('/auth', authRoutes);
router.use('/series', seriesRoutes);
router.use('/episodes', episodeRoutes);

module.exports = router; 