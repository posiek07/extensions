#!/usr/bin/env node

/*
 * Copyright 2019 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as bigquery from "@google-cloud/bigquery";
import * as program from "commander";
import * as firebase from "firebase-admin";
import * as inquirer from "inquirer";

import { FirestoreBigQuerySchemaViewFactory, FirestoreSchema } from "./schema";

import { readSchemas } from "./util";

const BIGQUERY_VALID_CHARACTERS = /^[a-zA-Z0-9_]+$/;
const FIRESTORE_VALID_CHARACTERS = /^[^\/]+$/;

const validateInput = (value: any, name: string, regex: RegExp) => {
  if (!value || value === "" || value.trim() === "") {
    return `Please supply a ${name}`;
  }
  if (!value.match(regex)) {
    return `The ${name} must only contain letters or spaces`;
  }
  return true;
};

function collect(value, previous) {
  return previous.concat([value]);
}

program
  .name("gen-schema-views")
  .option(
    "--non-interactive",
    "Parse all input from command line flags instead of prompting the caller.",
    false
  )
  .option(
    "-P, --project <project>",
    "Firebase Project ID for project containing Cloud Firestore database."
  )
  .option(
    "-d, --dataset <dataset>",
    "The ID of the BigQuery dataset containing a raw Cloud Firestore document changelog."
  )
  .option(
    "-t, --table-name-prefix <table-name-prefix>",
    "A common prefix for the names of all views generated by this script."
  )
  .option(
    "-f, --schema-files <schema-files>",
    "A path in the filesystem specifying a globbed collection of files to read schemas from.",
    collect,
    []
  );

const questions = [
  {
    message: "What is your Firebase project ID?",
    name: "project",
    type: "input",
    validate: (value) =>
      validateInput(value, "project ID", FIRESTORE_VALID_CHARACTERS),
  },
  {
    message:
      "What is the ID of the BigQuery dataset the raw changelog lives in? (The dataset and the raw changelog must already exist!)",
    name: "dataset",
    type: "input",
    validate: (value) =>
      validateInput(value, "dataset ID", BIGQUERY_VALID_CHARACTERS),
  },
  {
    message:
      "What is the name of the Cloud Firestore Collection that you would like to generate a schema view for?",
    name: "tableNamePrefix",
    type: "input",
    validate: (value) =>
      validateInput(value, "table name prefix", BIGQUERY_VALID_CHARACTERS),
  },
  {
    message:
      "Where should this script look for schema definitions? (Enter a comma-separated list of, optionally globbed, paths to files or directories).",
    name: "schemaFiles",
    type: "input",
  },
];

interface CliConfig {
  projectId: string;
  datasetId: string;
  tableNamePrefix: string;
  schemas: { [schemaName: string]: FirestoreSchema };
}

async function run(): Promise<number> {
  // Get all configuration options via inquirer prompt or commander flags.
  const config: CliConfig = await getConfig();

  // Set project ID so it can be used in BigQuery intialization
  process.env.PROJECT_ID = config.projectId;
  // BigQuery aactually requires this variable to set the project correctly.
  process.env.GOOGLE_CLOUD_PROJECT = config.projectId;

  // Initialize Firebase
  firebase.initializeApp({
    credential: firebase.credential.applicationDefault(),
    databaseURL: `https://${config.projectId}.firebaseio.com`,
  });

  // @ts-ignore string not assignable to enum
  if (Object.keys(config.schemas).length === 0) {
    console.log(`No schema files found!`);
  }
  const viewFactory = new FirestoreBigQuerySchemaViewFactory();
  for (let schemaName in config.schemas) {
    await viewFactory.initializeSchemaViewResources(
      config.datasetId,
      config.tableNamePrefix,
      schemaName,
      config.schemas[schemaName]
    );
  }
  return 0;
}

async function getConfig(): Promise<CliConfig> {
  let config: CliConfig = {
    projectId: undefined,
    datasetId: undefined,
    tableNamePrefix: undefined,
    schemas: undefined,
  };
  program.parse(process.argv);
  if (program.nonInteractive) {
    if (
      program.project === undefined ||
      program.dataset === undefined ||
      program.tableNamePrefix === undefined ||
      program.schemaFiles.length === 0
    ) {
      program.outputHelp();
      process.exit(1);
    }
    config.projectId = program.project;
    config.datasetId = program.dataset;
    config.tableNamePrefix = program.tableNamePrefix;
    config.schemas = readSchemas(program.schemaFiles);
  } else {
    const {
      project,
      dataset,
      tableNamePrefix,
      schemaFiles,
    } = await inquirer.prompt(questions);
    config.projectId = project;
    config.datasetId = dataset;
    config.tableNamePrefix = tableNamePrefix;
    config.schemas = readSchemas(
      schemaFiles.split(",").map((schemaFileName) => schemaFileName.trim())
    );
  }
  return config;
}

run()
  .then((result) => {
    console.log("done.");
    process.exit();
  })
  .catch((error) => {
    console.log(JSON.stringify(error));
    console.error(error.message);
    process.exit();
  });
