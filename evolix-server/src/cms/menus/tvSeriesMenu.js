const inquirer = require('inquirer');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { createTvSeries, generateFullCsv, addStreamLinks } = require('../operations/tvSeries');

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