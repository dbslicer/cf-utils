'use strict';
let config = require('./src/config');


module.exports = {

  /**
   * Configuration details for this cloud formation session.
   */
  config: config,

  /**
   * Cloudformation stack utilities
   */
  cloudFormation: require('./src/cloudFormation'),

  /**
   * Cloud watch log groups cloud formation utilities
   */
  cloudWatch: require('./src/cloudWatch'),

  /**
   * Cognito user pool cloud formation utilities
   */
  cognito: require('./src/cognito'),

  /**
   * Glue cloud formation utilities
   */
  glue: require('./src/glue'),

  /**
   * IAM cloud formation utilities
   */
  iam: require('./src/iam'),

  /**
   * Iot cloud formation utilities
   */
  iot: require('./src/iot'),

  /**
   * EC2 key pair cloud formation utilities
   */
  keypair: require('./src/keypair'),

  /**
   * Kinesis cloud formation utilities
   */
  kinesis: require('./src/kinesis'),

  /**
   * Lambda cloud formation utilities
   */
  lambda: require('./src/lambda'),

  /**
   * Parameter store cloud formation utilities
   */
  parameterStore: require('./src/parameterStore'),

  /**
   * S3 cloud formation utilities
   */
  s3: require('./src/s3'),

  /**
   * Convenience method to initialize configuration for this session
   * @param configuration configuration setup for this session
   */
  init : (configuration) => {
    config.init(configuration);
  },

  /**
   * Get the logger configured for this session
   * @return {*}
   */
  get logger() {
    return config.logger;
  }
};
