const express = require('express');
const router = express.Router();

const healthCheckRoutes = require("./healthCheck");
const tvSeriesRoutes = require("./tvSeriesRoutes");
const extractorsRoutes = require("./extractorRoutes");

router.use("/health-check", healthCheckRoutes);
router.use("/tv-series", tvSeriesRoutes);
router.use("/extractors", extractorsRoutes);

module.exports = router;
