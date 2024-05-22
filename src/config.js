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
      alias:       'foo'            // Alias (this parameter can be mapped to another name)
                                    // Useful to support different naming styles
    },
   *
   */
  schema : {
    PROJECT:             { description: 'ACS Project Name',                        alias: 'project'           },
    PROJECT_VERSION:     { description: 'ACS Project Version (e.g. poc, mvp1)',    alias: 'projectVersion'    },
    PROJECT_PREFIX:      { description: 'ACS Project Prefix',                      alias: 'projectPrefix'     },
    API_PACKAGE_PREFIX:  { description: 'API Package Prefix',  default: 'api-',    alias: 'apiPackagePrefix'  },
    API_PACKAGE_VERSION: { description: 'API Package Version', default: '0.0.1',   alias: 'apiPackageVersion' },
    AWS_PROFILE:         { description: 'AWS Profile',         argName: 'profile', alias: 'awsProfile'        },
    AWS_REGION:          { description: 'AWS Region',          argName: 'region',  alias: 'awsRegion'         },
    ENVIRONMENT_STAGE:   { description: 'Environment stage',   argName: 'env',     alias: 'environmentStage'  },
    ORGANIZATION:        { description: 'Organization Tag',    argName: 'org',     alias: 'organization'      },
    TENANT:              { description: 'Tenant',              argName: 'tenant',  alias: 'tenant'            }
  },

  /**
   * Initialize configuration.
   * @param configuration configuration setup for this session
   */
  init: (configuration) => {
    if (configuration.config) { Object.assign(baseConfig, configuration.config); }
    if (configuration.schema) { Object.assign(baseConfig.schema, configuration.schema); }
  },

  /**
   * Prime AWS environment and return AWS object.
   */
  get AWS() {
    return {
      /**
       * Generate Config for AWS Service Clients
       * @returns {{credentials: AwsCredentialIdentityProvider, retryStrategy: ConfiguredRetryStrategy}} Client Config
       */
      get clientConfig() {
        process.env.AWS_PROFILE = config.AWS_PROFILE;
        process.env.AWS_REGION = config.AWS_REGION;

        const { ConfiguredRetryStrategy } = require("@smithy/util-retry");
        const { fromIni } = require("@aws-sdk/credential-providers");

        delete this.clientConfig;
        this.clientConfig = {
          credentials: fromIni(),
          retryStrategy: new ConfiguredRetryStrategy(
            12, // max attempts / retries
            (retryAttempt) => 100 + retryAttempt * 1000 // backoff function
          )
        };
        return this.clientConfig;
      },
    };
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
  getResourceName: (suffix) => {
    return config.getResourcePrefix() + suffix;
  },

  /**
   * Get the prefix for all core resources
   * @return {string}
   */
  getResourcePrefix: () => {
    return config.PROJECT_PREFIX + config.ENVIRONMENT_STAGE + '-';
  },

  /**
   * Get the name of an org resource with the given suffix
   * @param suffix
   * @return {*}
   */
  getOrgResourceName: (suffix) => {
    return config.getOrgResourcePrefix() + suffix;
  },

  /**
   * Get the prefix for all org resources
   * @return {string}
   */
  getOrgResourcePrefix: () => {
    return config.PROJECT_PREFIX + config.ORGANIZATION + '-' + config.ENVIRONMENT_STAGE + '-';
  },

  /**
   * Get the name of an tenant resource with the given suffix
   * @param suffix
   * @return {*}
   */
  getTenantResourceName: (suffix) => {
    return config.getTenantResourcePrefix() + suffix;
  },

  /**
   * Get the prefix for all tenant resources
   * @return {string}
   */
  getTenantResourcePrefix: () => {
    return config.PROJECT_PREFIX + config.TENANT + '-' + config.ENVIRONMENT_STAGE + '-';
  },

  /**
   * Get the name of a core parameter with the given name
   * @param name
   * @return {*}
   */
  getParameterName: (name) => {
    return config.getParameterPrefix() + name;
  },

  /**
   * Get the prefix for all core parameters
   * @return {string}
   */
  getParameterPrefix: () => {
    return config.PROJECT_PREFIX + config.ENVIRONMENT_STAGE + '-' + config.AWS_REGION + '-';
  },

  /**
   * Get the name of a org parameter with the given name
   * @param name
   * @return {*}
   */
  getOrgParameterName: (name) => {
    return config.getOrgParameterPrefix() + name;
  },

  /**
   * Get the prefix for all org parameters
   * @return {string}
   */
  getOrgParameterPrefix: () => {
    return config.PROJECT_PREFIX + config.ORGANIZATION + '-' + config.ENVIRONMENT_STAGE + '-' + config.AWS_REGION + '-';
  },

  /**
   * Get the name of a tenant parameter with the given name
   * @param name
   * @return {*}
   */
  getTenantParameterName: (name) => {
    return config.getTenantParameterPrefix() + name;
  },

  /**
   * Get the prefix for all tenant parameters
   * @return {string}
   */
  getTenantParameterPrefix: () => {
    return config.PROJECT_PREFIX + config.TENANT + '-' + config.ENVIRONMENT_STAGE + '-' + config.AWS_REGION + '-';
  },

  /**
   * Get the name of the lambda zip file
   * @return {string}
   */
  getLambdaZipName: () => {
    return config.API_PACKAGE_PREFIX + config.API_PACKAGE_VERSION + '.zip';
  },

  /**
   * Get the S3 object key for the lambda bundle
   * @return {string}
   */
  getLambdaZipS3Key: () => {
    return 'api/' + config.getLambdaZipName();
  }

};

/**
 * Configuration details.
 */
let config = new Proxy(baseConfig, {
  /**
   * Get the specified config parameter (value will be sourced from command line, alias or schema default if available)
   */
  get: (target, parameter) => {
    if (!target.hasOwnProperty(parameter) && parameter !== 'inspect' && typeof (parameter) === 'string') {
      let value = undefined;
      let schema = target.schema[parameter] ||
        target.schema[Object.keys(target.schema).find(p => target.schema[p].alias === parameter)] || {};
      if (schema.argName && argv[schema.argName]) {
        value = argv[schema.argName];
      } else if (schema.alias) {
        value = target[schema.alias]
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
  },

  /**
   * Check if the specified config parameter has been defined (either directly, via command line, alias or default)
   */
  has: (target, parameter) => {
    if (!target.hasOwnProperty(parameter)) {
      let schema = target.schema[parameter] ||
        target.schema[Object.keys(target.schema).find(p => target.schema[p].alias === parameter)] || {};
      return (
        (schema.argName && argv[schema.argName]) ||
        (schema.alias && schema.alias in target) ||
        (schema.default));
    }
    return true;
  }

});


module.exports = config;
