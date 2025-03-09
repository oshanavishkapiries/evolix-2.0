#!/usr/bin/env node

const chalk = require('chalk');
const { mainMenu } = require('./menus/mainMenu');
require('dotenv').config();

// Connect to MongoDB
require('../config/database')();

// Start the CLI
mainMenu().catch((error) => {
    console.error(chalk.red.bold('Error:'), error.message);
    process.exit(1);
}); 