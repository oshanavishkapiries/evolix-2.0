const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
    low: { type: String, required: true },
    high: { type: String, required: true },
    original: { type: String, required: true }
});

const tvSerieSeasonsSchema = new mongoose.Schema({
    tmdb_id: { type: Number, required: true },
    seasonNumber: { type: Number, required: true },
    name: { type: String, required: true },
    overview: { type: String },
    episodeCount: { type: Number, required: true },
    airDate: { type: String, required: true },
    poster: { type: imageSchema, required: true },
    series: { type: mongoose.Schema.Types.ObjectId, ref: 'TvSeriesDetails' },
    episodes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TvSeriesEpisodes' }]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Compound index to ensure unique combination of tmdb_id and seasonNumber
tvSerieSeasonsSchema.index({ tmdb_id: 1, seasonNumber: 1 }, { unique: true });

// Virtual populate for episodes
tvSerieSeasonsSchema.virtual('episodesData', {
    ref: 'TvSeriesEpisodes',
    localField: 'tmdb_id',
    foreignField: 'tmdb_id',
    match: function() {
        return { seasonNumber: this.seasonNumber };
    }
});

// Virtual populate for series details
tvSerieSeasonsSchema.virtual('seriesData', {
    ref: 'TvSeriesDetails',
    localField: 'tmdb_id',
    foreignField: 'tmdb_id',
    justOne: true
});

module.exports = mongoose.model('TvSeriesSeasons', tvSerieSeasonsSchema); 