const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
    low: { type: String, required: true },
    high: { type: String, required: true },
    original: { type: String, required: true }
});

const streamSchema = new mongoose.Schema({
    provider: { type: String, required: true },
    video_link: { type: String },
    subtitle_link: { type: String },
    quality: { type: String, required: true }
});

const tvSerieEpisodesSchema = new mongoose.Schema({
    tmdb_id: { type: Number, required: true },
    seasonNumber: { type: Number, required: true },
    episodeNumber: { type: Number, required: true },
    name: { type: String, required: true },
    overview: { type: String },
    airDate: { type: String, required: true },
    poster: { type: imageSchema, required: true },
    rating: { type: String },
    stream: { type: streamSchema, required: true }
}, {
    timestamps: true
});

// Compound index to ensure unique combination of tmdb_id, seasonNumber, and episodeNumber
tvSerieEpisodesSchema.index(
    { tmdb_id: 1, seasonNumber: 1, episodeNumber: 1 }, 
    { unique: true }
);

module.exports = mongoose.model('TvSeriesEpisodes', tvSerieEpisodesSchema); 