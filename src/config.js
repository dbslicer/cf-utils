'use strict';


/**
 * Fetch command line arguments
 */
const argv = (() => {
  let tba = null;
  return process.argv.reduce((options, arg) => {
    if (arg.startsWith('--')) {
      tba = arg.replace(/^--/, '');
      options[tba] = true;
    } else {
      if (tba) {
        options[tba] = arg;
      }
      tba = null;
    }
    return options;
  }, {});
})();


/**
 * Core configuration details.
 */
let baseConfig = {

  /**
   * Default configuration schema.
   *
   * A schema element describes a configuration parameter.
   * argName and/or default will be used if set to source the value for a parameter.
   *
   * Example Schema:
   *
   FOO: {
      argName:     '--foo',         // Command line arg name
      description: 'Foo Parameter', // Description
      default:     'foo value'      // Default value
    },
   *
   */
  schema : {
    PROJECT:             { description: 'ACS Project Name'                        },
    PROJECT_VERSION:     { description: 'ACS Project Version (e.g. poc, mvp1)'    },
    PROJECT_PREFIX:      { description: 'ACS Project Prefix'                      },
    API_PACKAGE_PREFIX:  { description: 'API Package Prefix',  default: 'api-'    },
    API_PACKAGE_VERSION: { description: 'API Package Version', default: '0.0.1'   },
    AWS_PROFILE:         { description: 'AWS Profile',         argName: 'profile' },
    AWS_REGION:          { description: 'AWS Region',          argName: 'region'  },
    ENVIRONMENT_STAGE:   { description: 'Environment stage',   argName: 'env'     },
    ORGANIZATION:        { description: 'Organization Tag',    argName: 'org'     }
  },

  /**
   * Initialize configuration.
   * @param configuration configuration setup for this session
   */
  init : (configuration) => {
    if (configuration.config) { Object.assign(baseConfig, configuration.config); }
    if (configuration.schema) { Object.assign(baseConfig.schema, configuration.schema); }
  },

  /**
   * Prime AWS environment and return AWS object.
   */
  get AWS() {
    process.env.AWS_PROFILE = config.AWS_PROFILE;
    process.env.AWS_REGION = config.AWS_REGION;

    delete this.AWS;
    return this.AWS = require('aws-sdk');
  },

  /**
   * Get a logger for this session. Sets up a bunyan logger is not already set.
   */
  get logger() {
    // If logger not specified use bunyan by default
    let bunyan = require('bunyan');
    let PrettyStream = require('bunyan-prettystream');

    let prettyStdOut = new PrettyStream(); prettyStdOut.pipe(process.stdout);
    let prettyStdErr = new PrettyStream(); prettyStdErr.pipe(process.stderr);
    let name = config.PROJECT_PREFIX.slice(0, -1);

    delete this.logger;
    return this.logger = bunyan.createLogger({
      name: name,
      streams: [{
        level: 'debug',
        type: 'raw',
        stream: prettyStdOut,
        reemitErrorEvents: true
      }]
    });
  },
  set logger(logger) {
    delete this.logger;
    this.logger = logger;
  },

  /**
   * Get the name of a core resource with the given suffix
   * @param suffix
   * @return {*}
   */
  getResourceName : (suffix) => {
    return config.getResourcePrefix() + suffix;
  },

  /**
   * Get the prefix for all core resources
   * @return {string}
   */
  getResourcePrefix : () => {
    return config.PROJECT_PREFIX + config.ENVIRONMENT_STAGE + '-';
  },

  /**
   * Get the name of an org resource with the given suffix
   * @param suffix
   * @return {*}
   */
  getOrgResourceName : (suffix) => {
    return config.getOrgResourcePrefix() + suffix;
  },

  /**
   * Get the prefix for all org resources
   * @return {string}
   */
  getOrgResourcePrefix : () => {
    return config.PROJECT_PREFIX + config.ORGANIZATION + '-' + config.ENVIRONMENT_STAGE + '-';
  },

  /**
   * Get the name of a core parameter with the given name
   * @param name
   * @return {*}
   */
  getParameterName : (name) => {
    return config.getParameterPrefix() + name;
  },

  /**
   * Get the prefix for all core parameters
   * @return {string}
   */
  getParameterPrefix : () => {
    return config.PROJECT_PREFIX + config.ENVIRONMENT_STAGE + '-' + config.AWS_REGION + '-';
  },

  /**
   * Get the name of a org parameter with the given name
   * @param name
   * @return {*}
   */
  getOrgParameterName : (name) => {
    return config.getOrgParameterPrefix() + name;
  },

  /**
   * Get the prefix for all org parameters
   * @return {string}
   */
  getOrgParameterPrefix : () => {
    return config.PROJECT_PREFIX + config.ORGANIZATION + '-' + config.ENVIRONMENT_STAGE + '-' + config.AWS_REGION + '-';
  },

  /**
   * Get the name of the lambda zip file
   * @return {string}
   */
  getLambdaZipName : () => {
    return config.API_PACKAGE_PREFIX + config.API_PACKAGE_VERSION + '.zip';
  },

  /**
   * Get the S3 object key for the lambda bundle
   * @return {string}
   */
  getLambdaZipS3Key : () => {
    return 'api/' + config.getLambdaZipName();
  }

};

/**
 * Configuration details.
 */
let config = new Proxy(baseConfig, {
  /**
   * Get the specified config parameter (value will be sourced from command line or schema default if available)
   */
  get: (target, parameter) => {
    if (!target.hasOwnProperty(parameter)) {
      let value = undefined;
      let schema = target.schema[parameter] || {};
      if (schema.argName && argv[schema.argName]) {
        value = argv[schema.argName];
      }
      if (!value && schema.default) {
        value = schema.default;
      }
      if (value === undefined) {
        let error = (schema.argName) ?
          `${schema.description || parameter} is unset. Did you forget to set '--${schema.argName}' on command line?` :
          `${schema.description || parameter} is unset. Did you forget to set \'config.${parameter}\'?`;
        throw new Error(error);
      }
      return target.parameter = value;
    }
    return target[parameter];
  }

});


module.exports = config;
