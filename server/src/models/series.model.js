const mongoose = require('mongoose');

const seriesSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  genre: [{
    type: String,
    required: true
  }],
  releaseYear: {
    type: Number,
    required: true
  },
  posterUrl: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    min: 0,
    max: 10,
    default: 0
  },
  totalSeasons: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['ongoing', 'completed', 'upcoming'],
    default: 'ongoing'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Series', seriesSchema); 