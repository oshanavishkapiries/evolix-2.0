const inquirer = require("inquirer");
const chalk = require("chalk");
const { tvSeriesMenu } = require("./tvSeriesMenu");

const mainMenu = async () => {
  console.clear();
  console.log(chalk.blue.bold("=== Evolix CMS Tool ===\n"));

  const { operation } = await inquirer.prompt([
    {
      type: "list",
      name: "operation",
      message: "Choose operation:",
      choices: [
        {
          name: chalk.green("TV Series Database Operations"),
          value: "tv_series",
        },
        {
          name: chalk.red("Exit"),
          value: "exit",
        },
      ],
    },
  ]);

  if (operation === "exit") {
    console.log(chalk.red.bold("\nGoodbye! 👋\n"));
    process.exit(0);
  }

  if (operation === "tv_series") {
    await tvSeriesMenu();
  } else if (operation === "movies") {
    console.log(chalk.yellow("\nMovies operations coming soon...\n"));
    await mainMenu();
  }
};

module.exports = { mainMenu };
