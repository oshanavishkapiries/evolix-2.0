const TvSeriesSeasons = require("../models/TvSeriesSeasons");
const TvSeriesDetails = require("../models/TvSeriesDetails");
const TvSeriesEpisodes = require("../models/TvSeriesEpisodes");


class TvSeriesService {
  async getAllTvSeries(page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const tvSeries = await TvSeriesDetails.find()
        .select(
          "title year rating numberOfSeasons mainBackdrop.low tmdb_id genres mainPoster.low _id"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      return tvSeries;
    } catch (error) {
      throw new Error(`Error fetching TV series: ${error.message}`);
    }
  }

  async searchTvSeries(searchTerm, page = 1, limit = 20) {
    try {
      const skip = (page - 1) * limit;

      const tvSeries = await TvSeriesDetails.find(
        { $text: { $search: searchTerm } },
        { score: { $meta: "textScore" } }
      )
        .select(
          "title year rating numberOfSeasons mainBackdrop.low tmdb_id genres mainPoster.low _id"
        )
        .sort({ score: { $meta: "textScore" } })
        .skip(skip)
        .limit(parseInt(limit));

      return tvSeries;
    } catch (error) {
      throw new Error(`Error searching TV series: ${error.message}`);
    }
  }

  async getDetailsByTvSeriesId(id) {
    try {
      const tvSeries = await TvSeriesDetails.findById(id).select("-seasons");
      return tvSeries;
    } catch (error) {
      throw new Error(`Error fetching TV series details: ${error.message}`);
    }
  }

  async getSeasonsByTvSeriesId(id) {
    try {
      const tvSeries = await TvSeriesDetails.findById(id)
        .select("seasons")
        .populate({
          path: "seasons",
          select: "-episodes",
        });
      return tvSeries;
    } catch (error) {
      throw new Error(`Error fetching TV series seasons: ${error.message}`);
    }
  }

  async getEpisodesBySeasonId(id) {
    try {
      const season = await TvSeriesSeasons.findById(id).populate({
        path: "episodes",
        select: "episodeNumber name overview airDate poster rating stream",
      });
      return season;
    } catch (error) {
      throw new Error(`Error fetching TV series episodes: ${error.message}`);
    }
  }
}

module.exports = new TvSeriesService();
