const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema({
  series: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Series',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  seasonNumber: {
    type: Number,
    required: true,
    min: 1
  },
  episodeNumber: {
    type: Number,
    required: true,
    min: 1
  },
  duration: {
    type: Number, // in minutes
    required: true
  },
  videoUrl: {
    type: String,
    required: true
  },
  thumbnailUrl: {
    type: String,
    required: true
  },
  releaseDate: {
    type: Date,
    required: true
  }
}, {
  timestamps: true
});

// Compound index to ensure unique episode numbers within a season of a series
episodeSchema.index({ series: 1, seasonNumber: 1, episodeNumber: 1 }, { unique: true });

module.exports = mongoose.model('Episode', episodeSchema); 