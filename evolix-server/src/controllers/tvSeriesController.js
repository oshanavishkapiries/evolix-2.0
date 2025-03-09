const tvSeriesService = require("../services/tvSeriesService");
const paginate = require("express-paginate");
const {
  successResponse,
  badRequestResponse,
  unauthorizedResponse,
  notFoundResponse,
  serverErrorResponse,
} = require("../utils/responceUtil");

const getAllTvSeries = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';

    let result;
    if (search && search.trim()) {
      result = await tvSeriesService.searchTvSeries(search, page, limit);
    } else {
      result = await tvSeriesService.getAllTvSeries(page, limit);
    }

    if (!result || result.length === 0) {
      return successResponse(res, "No TV Series found", {
        results: [],
        pageCount: 0,
        itemCount: 0,
        pages: [],
        hasMore: false,
        currentPage: page
      });
    }

    const pageCount = Math.ceil(result.length / limit);
    const response = {
      results: result,
      pageCount,
      itemCount: result.length,
      pages: paginate.getArrayPages(req)(3, pageCount, page), 
      hasMore: paginate.hasNextPages(req)(pageCount),
      currentPage: page
    };

    successResponse(res, "TV Series fetched successfully", response);
  } catch (error) {
    console.error("Error in getAllTvSeries:", error);
    serverErrorResponse(res, error.message);
  }
};

const getDetailsByTvSeriesId = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tvSeriesService.getDetailsByTvSeriesId(id);
    successResponse(res, "TV Series details fetched successfully", result);
  } catch (error) {
    console.error("Error in getDetailsByTvSeriesId:", error);
    serverErrorResponse(res, error.message);
  }
};

const getSeasonsByTvSeriesId = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tvSeriesService.getSeasonsByTvSeriesId(id);
    successResponse(res, "TV Series seasons fetched successfully", result);
  } catch (error) {
    console.error("Error in getSeasonsByTvSeriesId:", error);
    serverErrorResponse(res, error.message);
  }
};

const getEpisodesBySeasonId = async (req, res) => {
  try {
    const { seasonId } = req.params;
    const result = await tvSeriesService.getEpisodesBySeasonId(seasonId);
    successResponse(res, "TV Series episodes fetched successfully", result);
  } catch (error) {
    console.error("Error in getEpisodesBySeasonId:", error);
    serverErrorResponse(res, error.message);
  }
};

module.exports = {
  getAllTvSeries,
  getDetailsByTvSeriesId,
  getSeasonsByTvSeriesId,
  getEpisodesBySeasonId,
};
