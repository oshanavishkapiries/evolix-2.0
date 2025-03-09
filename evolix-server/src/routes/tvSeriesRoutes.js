const express = require("express");
const router = express.Router();

const {
  getAllTvSeries,
  getDetailsByTvSeriesId,
  getSeasonsByTvSeriesId,
  getEpisodesBySeasonId,
} = require("../controllers/tvSeriesController");

router.route("/").get(getAllTvSeries);
router.route("/:id").get(getDetailsByTvSeriesId);
router.route("/:id/seasons").get(getSeasonsByTvSeriesId);
router.route("/:seasonId/episodes").get(getEpisodesBySeasonId);

module.exports = router;
