const axios = require("axios");

const TMDB_API_URL = "https://api.themoviedb.org/3";
const TMDB_API_KEY_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIzNzFkYmE0YzUwNjY3NWUyZWRlNzdiYzAwYWU0NzA1MiIsIm5iZiI6MTYzODAzMDA5MS41NjYwMDAyLCJzdWIiOiI2MWEyNWIwYjNkNGQ5NjAwOTE5Nzk3ZDMiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.-UKEnv1PslkvPm0PTaMnBcZao66XBB76GycLkmD6tHQ";

const imageSizes = {
  low: "https://image.tmdb.org/t/p/w500",
  high: "https://image.tmdb.org/t/p/w1280",
  original: "https://image.tmdb.org/t/p/original",
};

const axiosInstance = axios.create({
  baseURL: TMDB_API_URL,
  headers: {
    Authorization: `Bearer ${TMDB_API_KEY_TOKEN}`,
  },
});

const getTvShowsData = async (id) => {
  const response = await axiosInstance.get(`${TMDB_API_URL}/tv/${id}`);

  const getImages = async () => {
    const response = await axiosInstance.get(`${TMDB_API_URL}/tv/${id}/images`);
    return response.data;
  };

  const getSeasonDetails = async (seasonNumber) => {
    const response = await axiosInstance.get(
      `${TMDB_API_URL}/tv/${id}/season/${seasonNumber}`
    );
    return response.data;
  };

  const images = await getImages();
  const seasons = await Promise.all(
    Array.from({ length: response.data.number_of_seasons }, (_, i) =>
      getSeasonDetails(i + 1)
    )
  );

  const logos = images.logos.slice(0, 3).map((logo) => {
    return {
      low: `${imageSizes.low}${logo.file_path}`,
      high: `${imageSizes.high}${logo.file_path}`,
      original: `${imageSizes.original}${logo.file_path}`,
    };
  });

  const backdrops = images.backdrops.slice(0, 3).map((backdrop) => {
    return {
      low: `${imageSizes.low}${backdrop.file_path}`,
      high: `${imageSizes.high}${backdrop.file_path}`,
      original: `${imageSizes.original}${backdrop.file_path}`,
    };
  });

  const data = {
    tmdb_id: response.data.id,
    title: response.data.name,
    overview: response.data.overview,
    mainPoster: {
      low: `${imageSizes.low}${response.data.poster_path}`,
      high: `${imageSizes.high}${response.data.poster_path}`,
      original: `${imageSizes.original}${response.data.poster_path}`,
    },
    mainBackdrop: {
      low: `${imageSizes.low}${response.data.backdrop_path}`,
      high: `${imageSizes.high}${response.data.backdrop_path}`,
      original: `${imageSizes.original}${response.data.backdrop_path}`,
    },
    rating: response.data.vote_average.toFixed(1),
    genres: response.data.genres.map((genre) => genre.name).join(", "),
    year: response.data.first_air_date.split("-")[0],
    status: response.data.status,
    numberOfSeasons: response.data.number_of_seasons,
    numberOfEpisodes: response.data.number_of_episodes,
    seasons: seasons.map((season) => ({
      seasonNumber: season.season_number,
      name: season.name,
      overview: season.overview,
      episodeCount: season.episodes.length,
      airDate: season.air_date,
      poster: season.poster_path
        ? {
            low: `${imageSizes.low}${season.poster_path}`,
            high: `${imageSizes.high}${season.poster_path}`,
            original: `${imageSizes.original}${season.poster_path}`,
          }
        : null,
      episodes: season.episodes.map((episode) => ({
        episodeNumber: episode.episode_number,
        name: episode.name,
        overview: episode.overview,
        airDate: episode.air_date,
        poster: episode.still_path
          ? {
              low: `${imageSizes.low}${episode.still_path}`,
              high: `${imageSizes.high}${episode.still_path}`,
              original: `${imageSizes.original}${episode.still_path}`,
            }
          : null,
        rating: episode.vote_average.toFixed(1),
        stream: {
          provider: "mixdrop",
          video_link: null,
          subtitle_link: null,
          quality: "720p",
        },
      })),
    })),
    logos: logos,
    backdrops: backdrops,
  };

  return data;
};

module.exports = { getTvShowsData };
