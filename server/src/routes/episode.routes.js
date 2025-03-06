const express = require('express');
const router = express.Router();
const episodeController = require('../controllers/episode.controller');

// Episode routes
router.get('/', episodeController.getAllEpisodes);
router.get('/:id', episodeController.getEpisodeById);
router.post('/', episodeController.createEpisode);
router.put('/:id', episodeController.updateEpisode);
router.delete('/:id', episodeController.deleteEpisode);

module.exports = router; 