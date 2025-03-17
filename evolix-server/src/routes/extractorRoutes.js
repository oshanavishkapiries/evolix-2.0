const express = require("express");
const router = express.Router();

const {
  mixdropVideo,
  mixdropMetaData,
} = require("../controllers/extractorsController");

router.route("/mixdrop/video").get(mixdropVideo);
router.route("/mixdrop/metaData").get(mixdropMetaData);

module.exports = router;
