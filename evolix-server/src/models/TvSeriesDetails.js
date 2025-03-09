const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
    low: { type: String, required: true },
    high: { type: String, required: true },
    original: { type: String, required: true }
});

const tvSeriesDetailsSchema = new mongoose.Schema({
    tmdb_id: { type: Number, required: true, unique: true },
    title: { type: String, required: true },
    overview: { type: String, required: true },
    mainPoster: { type: imageSchema, required: true },
    mainBackdrop: { type: imageSchema, required: true },
    rating: { type: String, required: true },
    genres: { type: String, required: true },
    year: { type: String, required: true },
    status: { type: String, required: true },
    numberOfSeasons: { type: Number, required: true },
    numberOfEpisodes: { type: Number, required: true },
    logos: [imageSchema],
    backdrops: [imageSchema],
    seasons: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TvSeriesSeasons' }]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual populate for seasons
tvSeriesDetailsSchema.virtual('seasonsData', {
    ref: 'TvSeriesSeasons',
    localField: 'tmdb_id',
    foreignField: 'tmdb_id'
});

// Add text index for search
tvSeriesDetailsSchema.index({ title: 'text' });

module.exports = mongoose.model('TvSeriesDetails', tvSeriesDetailsSchema); 