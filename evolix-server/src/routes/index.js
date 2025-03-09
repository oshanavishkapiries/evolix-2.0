const express = require('express');
const router = express.Router();

const healthCheckRoutes = require("./healthCheck");
const tvSeriesRoutes = require("./tvSeriesRoutes");

router.use("/health-check", healthCheckRoutes);
router.use("/tv-series", tvSeriesRoutes);

module.exports = router;
