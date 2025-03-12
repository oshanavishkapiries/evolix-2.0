const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { createTvSeries, generateFullCsv, addStreamLinks, deleteTvSeries, listTvSeries } = require('../operations/tvSeries');

const tvSeriesMenu = async () => {
    console.clear();
    console.log(chalk.green.bold('=== TV Series Operations ===\n'));

    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Choose action:',
            choices: [
                {
                    name: chalk.blue('List TV Series'),
                    value: 'list'
                },
                {
                    name: chalk.blue('Create TV Series'),
                    value: 'create'
                },
                {
                    name: chalk.blue('Generate Episodes CSV'),
                    value: 'generate_csv'
                },
                {
                    name: chalk.blue('Update Stream Links from CSV'),
                    value: 'update_streams'
                },
                {
                    name: chalk.red('Delete TV Series'),
                    value: 'delete'
                },
                {
                    name: chalk.yellow('Back to Main Menu'),
                    value: 'back'
                }
            ]
        }
    ]);

    if (action === 'back') {
        const { mainMenu } = require('./mainMenu');
        await mainMenu();
        return;
    }

    if (action === 'create') {
        await handleCreateTvSeries();
    } else if (action === 'generate_csv') {
        await handleGenerateFullCsv();
    } else if (action === 'update_streams') {
        await handleUpdateStreamLinks();
    } else if (action === 'delete') {
        await handleDeleteTvSeries();
    } else if (action === 'list') {
        await handleListTvSeries();
    }
};

const handleCreateTvSeries = async () => {
    const { tmdbId } = await inquirer.prompt([
        {
            type: 'input',
            name: 'tmdbId',
            message: 'Enter TMDB ID:',
            validate: (input) => {
                if (!input || isNaN(input)) {
                    return 'Please enter a valid TMDB ID';
                }
                return true;
            }
        }
    ]);

    await createTvSeries(parseInt(tmdbId));
    await continueOrExit();
};

const handleGenerateFullCsv = async () => {
    const { tmdbId } = await inquirer.prompt([
        {
            type: 'input',
            name: 'tmdbId',
            message: 'Enter TMDB ID of the series:',
            validate: (input) => {
                if (!input || isNaN(input)) {
                    return 'Please enter a valid TMDB ID';
                }
                return true;
            }
        }
    ]);

    await generateFullCsv(parseInt(tmdbId));
    await continueOrExit();
};

const handleUpdateStreamLinks = async () => {
    const { csvPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'csvPath',
            message: 'Enter the path to your updated CSV file:',
            validate: (input) => {
                if (!input) {
                    return 'Please enter a file path';
                }
                if (!fs.existsSync(input)) {
                    return 'File not found! Please check the path';
                }
                return true;
            }
        }
    ]);

    await addStreamLinks(csvPath);
    await continueOrExit();
};

const handleDeleteTvSeries = async () => {
    const { tmdbId, confirm } = await inquirer.prompt([
        {
            type: 'input',
            name: 'tmdbId',
            message: 'Enter TMDB ID of the series to delete:',
            validate: (input) => {
                if (!input || isNaN(input)) {
                    return 'Please enter a valid TMDB ID';
                }
                return true;
            }
        },
        {
            type: 'confirm',
            name: 'confirm',
            message: chalk.red.bold('WARNING: This will delete all data related to this series. Are you sure?'),
            default: false
        }
    ]);

    if (confirm) {
        await deleteTvSeries(parseInt(tmdbId));
    } else {
        console.log(chalk.yellow('\nDeletion cancelled.'));
    }
    await continueOrExit();
};

const handleListTvSeries = async () => {
    let currentPage = 1;
    let searchQuery = '';
    const limit = 10;

    while (true) {
        console.clear();
        const result = await listTvSeries(currentPage, limit, searchQuery);

        const choices = [
            ...(result.hasPrevPage ? [{ name: chalk.blue('◄ Previous Page'), value: 'prev' }] : []),
            ...(result.hasNextPage ? [{ name: chalk.blue('Next Page ►'), value: 'next' }] : []),
            { name: chalk.yellow('Search'), value: 'search' },
            { name: chalk.yellow('Back to Menu'), value: 'back' }
        ];

        const { action } = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Choose action:',
                choices
            }
        ]);

        if (action === 'prev' && result.hasPrevPage) {
            currentPage--;
        } else if (action === 'next' && result.hasNextPage) {
            currentPage++;
        } else if (action === 'search') {
            const { query } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'query',
                    message: 'Enter search term (title or TMDB ID):',
                }
            ]);
            searchQuery = query;
            currentPage = 1;
        } else if (action === 'back') {
            break;
        }
    }

    await tvSeriesMenu();
};

const continueOrExit = async () => {
    const { continue: shouldContinue } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'continue',
            message: 'Do you want to perform another operation?',
            default: true
        }
    ]);

    if (shouldContinue) {
        const { mainMenu } = require('./mainMenu');
        await mainMenu();
    } else {
        console.log(chalk.red.bold('\nGoodbye! 👋\n'));
        process.exit(0);
    }
};

module.exports = { tvSeriesMenu }; 