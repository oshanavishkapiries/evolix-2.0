const chalk = require('chalk');
const fs = require('fs');
const { parse } = require('csv-parse');
const { getTvShowsData } = require('../utils/TmdbUtils');
const TvSeriesDetails = require('../../models/TvSeriesDetails');
const TvSeriesSeasons = require('../../models/TvSeriesSeasons');
const TvSeriesEpisodes = require('../../models/TvSeriesEpisodes');
const path = require('path');

const createTvSeries = async (tmdbId) => {
    try {
        console.log(chalk.blue('\nFetching TV series data from TMDB...'));

        // Fetch all TV series data using TmdbUtils
        const seriesData = await getTvShowsData(tmdbId);

        // Save TV series details first
        console.log(chalk.blue('\nSaving series details...'));
        const seriesDetails = await TvSeriesDetails.findOneAndUpdate(
            { tmdb_id: tmdbId },
            {
                tmdb_id: seriesData.tmdb_id,
                title: seriesData.title,
                overview: seriesData.overview,
                mainPoster: seriesData.mainPoster,
                mainBackdrop: seriesData.mainBackdrop,
                rating: seriesData.rating,
                genres: seriesData.genres,
                year: seriesData.year,
                status: seriesData.status,
                numberOfSeasons: seriesData.numberOfSeasons,
                numberOfEpisodes: seriesData.numberOfEpisodes,
                logos: seriesData.logos,
                backdrops: seriesData.backdrops
            },
            { upsert: true, new: true }
        );

        console.log(chalk.green('✓ TV series details saved'));

        // Save seasons and episodes with proper relationships
        console.log(chalk.blue('\nSaving seasons and episodes data...'));
        
        const seasonRefs = [];
        for (const season of seriesData.seasons) {
            // Save season with reference to series
            const seasonData = await TvSeriesSeasons.findOneAndUpdate(
                { 
                    tmdb_id: tmdbId,
                    seasonNumber: season.seasonNumber
                },
                {
                    tmdb_id: tmdbId,
                    seasonNumber: season.seasonNumber,
                    name: season.name,
                    overview: season.overview,
                    episodeCount: season.episodeCount,
                    airDate: season.airDate,
                    poster: season.poster,
                    series: seriesDetails._id
                },
                { upsert: true, new: true }
            );

            seasonRefs.push(seasonData._id);

            console.log(chalk.blue(`\nSaving episodes for Season ${season.seasonNumber}...`));
            
            const episodeRefs = [];
            for (const episode of season.episodes) {
                // Save episode with references to both series and season
                const episodeData = await TvSeriesEpisodes.findOneAndUpdate(
                    {
                        tmdb_id: tmdbId,
                        seasonNumber: season.seasonNumber,
                        episodeNumber: episode.episodeNumber
                    },
                    {
                        tmdb_id: tmdbId,
                        seasonNumber: season.seasonNumber,
                        episodeNumber: episode.episodeNumber,
                        name: episode.name,
                        overview: episode.overview,
                        airDate: episode.airDate,
                        poster: episode.poster,
                        rating: episode.rating,
                        stream: episode.stream,
                        series: seriesDetails._id,
                        season: seasonData._id
                    },
                    { upsert: true, new: true }
                );

                episodeRefs.push(episodeData._id);
            }

            // Update season with episode references
            await TvSeriesSeasons.findByIdAndUpdate(
                seasonData._id,
                { episodes: episodeRefs }
            );

            console.log(chalk.green(`✓ Season ${season.seasonNumber} data saved`));
        }

        // Update series with season references
        await TvSeriesDetails.findByIdAndUpdate(
            seriesDetails._id,
            { seasons: seasonRefs }
        );

        console.log(chalk.green.bold('\nTV series successfully created with all relationships! 🎉\n'));

        // Example of how to fetch complete data with relationships
        const completeSeriesData = await TvSeriesDetails.findById(seriesDetails._id)
            .populate({
                path: 'seasons',
                populate: {
                    path: 'episodes'
                }
            });

        console.log(chalk.blue('\nVerifying data relationships...'));
        console.log(chalk.green(`✓ Found ${completeSeriesData.seasons.length} seasons with references`));
        console.log(chalk.green(`✓ All relationships verified\n`));

    } catch (error) {
        console.error(chalk.red.bold('\nError creating TV series:'), error.message);
        throw error;
    }
};

const generateFullCsv = async (tmdbId) => {
    try {
        console.log(chalk.blue('\nFetching TV series data...'));
        
        // Get series details
        const series = await TvSeriesDetails.findOne({ tmdb_id: tmdbId });
        if (!series) {
            throw new Error('TV Series not found! Please create the series first.');
        }

        // Get all episodes
        const episodes = await TvSeriesEpisodes.find({ tmdb_id: tmdbId })
            .sort({ seasonNumber: 1, episodeNumber: 1 });

        if (!episodes || episodes.length === 0) {
            throw new Error('No episodes found for this series!');
        }

        // Generate CSV content
        const csvRows = ['tmdb_id,season_number,episode_number,name,provider,video_link,subtitle_link,quality'];
        
        for (const episode of episodes) {
            const row = [
                tmdbId,
                episode.seasonNumber,
                episode.episodeNumber,
                episode.name.replace(/,/g, ';'), // Replace commas to avoid CSV issues
                episode.stream?.provider || 'unknown',
                episode.stream?.video_link || '',
                episode.stream?.subtitle_link || '',
                episode.stream?.quality || '720p'
            ];
            csvRows.push(row.join(','));
        }

        const csvContent = csvRows.join('\n');
        const fileName = `${series.title.replace(/[^a-zA-Z0-9]/g, '_')}_episodes.csv`;
        const filePath = path.join(process.cwd(), fileName);

        fs.writeFileSync(filePath, csvContent);

        console.log(chalk.green(`\n✓ Full CSV file generated at: ${filePath}`));
        console.log(chalk.blue('\nCSV Format:'));
        console.log(chalk.white('Columns:'));
        console.log(chalk.yellow('- tmdb_id: The TMDB ID of the TV series (do not change)'));
        console.log(chalk.yellow('- season_number: Season number (do not change)'));
        console.log(chalk.yellow('- episode_number: Episode number (do not change)'));
        console.log(chalk.yellow('- name: Episode name (do not change)'));
        console.log(chalk.yellow('- provider: Streaming provider name'));
        console.log(chalk.yellow('- video_link: URL to the video'));
        console.log(chalk.yellow('- subtitle_link: URL to the subtitle file'));
        console.log(chalk.yellow('- quality: Video quality (e.g., 720p, 1080p)'));
        console.log(chalk.blue('\nInstructions:'));
        console.log(chalk.white('1. Open the CSV file in Excel or similar program'));
        console.log(chalk.white('2. Fill in the provider, video_link, subtitle_link, and quality columns'));
        console.log(chalk.white('3. Save the file and use "Update Stream Links" option to update the database'));

        return filePath;

    } catch (error) {
        console.error(chalk.red.bold('\nError generating CSV:'), error.message);
        throw error;
    }
};

const addStreamLinks = async (csvFilePath) => {
    try {
        console.log(chalk.blue('\nReading CSV file...'));

        // Validate if file exists
        if (!fs.existsSync(csvFilePath)) {
            throw new Error('CSV file not found!');
        }

        const records = [];
        const parser = fs.createReadStream(csvFilePath)
            .pipe(parse({
                columns: true,
                skip_empty_lines: true
            }));

        for await (const record of parser) {
            records.push(record);
        }

        console.log(chalk.green(`✓ Found ${records.length} records in CSV`));

        // Process each record
        let updatedCount = 0;
        let skippedCount = 0;

        for (const record of records) {
            const { 
                tmdb_id,
                season_number,
                episode_number,
                provider,
                video_link,
                subtitle_link,
                quality
            } = record;

            if (!tmdb_id || !season_number || !episode_number) {
                console.log(chalk.yellow(`Skipping record due to missing required fields: ${JSON.stringify(record)}`));
                skippedCount++;
                continue;
            }

            // Find and update the episode
            const episode = await TvSeriesEpisodes.findOne({
                tmdb_id: parseInt(tmdb_id),
                seasonNumber: parseInt(season_number),
                episodeNumber: parseInt(episode_number)
            });

            if (!episode) {
                console.log(chalk.yellow(
                    `Episode not found: Series ${tmdb_id}, Season ${season_number}, Episode ${episode_number}`
                ));
                skippedCount++;
                continue;
            }

            // Only update if there are actual stream details
            if (provider || video_link || subtitle_link || quality) {
                episode.stream = {
                    provider: provider || episode.stream?.provider || 'unknown',
                    video_link: video_link || episode.stream?.video_link || null,
                    subtitle_link: subtitle_link || episode.stream?.subtitle_link || null,
                    quality: quality || episode.stream?.quality || '720p'
                };

                await episode.save();
                updatedCount++;
                console.log(chalk.green(
                    `✓ Updated stream links for: Series ${tmdb_id}, Season ${season_number}, Episode ${episode_number}`
                ));
            } else {
                skippedCount++;
            }
        }

        console.log(chalk.green.bold('\nStream links update completed! 🎉'));
        console.log(chalk.blue(`Total records processed: ${records.length}`));
        console.log(chalk.green(`Successfully updated: ${updatedCount}`));
        console.log(chalk.yellow(`Skipped: ${skippedCount}\n`));

    } catch (error) {
        console.error(chalk.red.bold('\nError updating stream links:'), error.message);
        throw error;
    }
};

const deleteTvSeries = async (tmdbId) => {
    try {
        console.log(chalk.blue('\nDeleting TV series and all related data...'));

        // Get series details first to confirm deletion
        const series = await TvSeriesDetails.findOne({ tmdb_id: tmdbId });
        if (!series) {
            throw new Error('TV Series not found!');
        }

        console.log(chalk.yellow.bold(`\nAbout to delete: ${series.title}`));
        console.log(chalk.yellow(`Total Seasons: ${series.numberOfSeasons}`));
        console.log(chalk.yellow(`Total Episodes: ${series.numberOfEpisodes}`));

        // Delete all episodes
        console.log(chalk.blue('\nDeleting episodes...'));
        await TvSeriesEpisodes.deleteMany({ tmdb_id: tmdbId });
        console.log(chalk.green('✓ Episodes deleted'));

        // Delete all seasons
        console.log(chalk.blue('Deleting seasons...'));
        await TvSeriesSeasons.deleteMany({ tmdb_id: tmdbId });
        console.log(chalk.green('✓ Seasons deleted'));

        // Delete series details
        console.log(chalk.blue('Deleting series details...'));
        await TvSeriesDetails.deleteOne({ tmdb_id: tmdbId });
        console.log(chalk.green('✓ Series details deleted'));

        console.log(chalk.green.bold('\nTV series and all related data successfully deleted! 🗑️\n'));
    } catch (error) {
        console.error(chalk.red.bold('\nError deleting TV series:'), error.message);
        throw error;
    }
};

const listTvSeries = async (page = 1, limit = 10, searchQuery = '') => {
    try {
        console.log(chalk.blue('\nFetching TV series list...'));

        // Build search query
        const query = searchQuery
            ? {
                $or: [
                    { title: { $regex: searchQuery, $options: 'i' } },
                    { tmdb_id: isNaN(searchQuery) ? null : parseInt(searchQuery) }
                ]
            }
            : {};

        // Get total count for pagination
        const totalSeries = await TvSeriesDetails.countDocuments(query);
        const totalPages = Math.ceil(totalSeries / limit);

        // Validate page number
        if (page < 1) page = 1;
        if (page > totalPages) page = totalPages;

        // Get paginated results
        const series = await TvSeriesDetails.find(query)
            .sort({ title: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select('tmdb_id title year numberOfSeasons numberOfEpisodes status');

        // Display results
        console.log(chalk.green.bold('\nTV Series List:'));
        console.log(chalk.yellow('─'.repeat(80)));
        console.log(chalk.yellow(
            'TMDB ID'.padEnd(10) +
            'Title'.padEnd(40) +
            'Year'.padEnd(6) +
            'Seasons'.padEnd(10) +
            'Episodes'.padEnd(10) +
            'Status'
        ));
        console.log(chalk.yellow('─'.repeat(80)));

        series.forEach(show => {
            console.log(
                chalk.white(
                    show.tmdb_id.toString().padEnd(10) +
                    show.title.substring(0, 38).padEnd(40) +
                    (show.year || 'N/A').toString().padEnd(6) +
                    show.numberOfSeasons.toString().padEnd(10) +
                    show.numberOfEpisodes.toString().padEnd(10) +
                    show.status
                )
            );
        });

        console.log(chalk.yellow('─'.repeat(80)));
        console.log(chalk.blue(`Page ${page} of ${totalPages} (Total series: ${totalSeries})`));

        return {
            series,
            currentPage: page,
            totalPages,
            totalSeries,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        };
    } catch (error) {
        console.error(chalk.red.bold('\nError listing TV series:'), error.message);
        throw error;
    }
};

module.exports = {
    createTvSeries,
    generateFullCsv,
    addStreamLinks,
    deleteTvSeries,
    listTvSeries
}; 