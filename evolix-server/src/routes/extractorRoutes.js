const express = require("express");
const router = express.Router();

const {
  mixdropVideo,
  mixdropSubtitle,
  mixdropMetaData,
} = require("../controllers/extractorsController");

router.route("/mixdrop/video").get(mixdropVideo);
router.route("/mixdrop/subtitle").get(mixdropSubtitle);
router.route("/mixdrop/metaData").get(mixdropMetaData);

module.exports = router;
