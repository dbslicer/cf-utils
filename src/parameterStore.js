'use strict';
const config = require('./config');
const {
  SSMClient,
  PutParameterCommand,
  GetParametersCommand,
  DeleteParameterCommand
} = require('@aws-sdk/client-ssm');

/**
 * Upsert parameter
 * @param params AWS putParameter params
 * @return {Promise}
 */
function putParameter(params) {
  return new Promise((resolve, reject) => {
    const ssm = new SSMClient(config.AWS.clientConfig);
    ssm.send(new PutParameterCommand(params), (err) => {
      if (err) {
        reject(err);
      } else {
        config.logger.info('Successfully upserted parameter: ' + params.Name);
        resolve(params.Name);
      }
    });
  });
}

/**
 * Retrieve the value of the specified parameter
 * @param name name of the parameter
 * @return {Promise}
 */
function getParameter(name) {
  return new Promise((resolve, reject) => {
    let params = {
      Names: [name],
      WithDecryption: true
    };
    const ssm = new SSMClient(config.AWS.clientConfig);
    ssm.send(new GetParametersCommand(params), (err, data) => {
      if (err) {
        reject(err);
      } else {
        if (data.Parameters && data.Parameters.length > 0) {
          config.logger.info('Successfully retrieved parameter: ' + params.Name);
          resolve(data.Parameters[0]);
        } else {
          reject('Parameter not found');
        }
      }
    });
  });
}

/**
 * Check if the specified parameter exists
 * @param name
 * @return {Promise}
 */
function checkParameter(name) {
  return new Promise((resolve, reject) => {
    let params = {
      Names: [name]
    };
    const ssm = new SSMClient(config.AWS.clientConfig);
    ssm.send(new GetParametersCommand(params), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.Parameters && data.Parameters.length > 0);
      }
    });
  });
}

/**
 * Delete the specified parameter
 * @param name name of the parameter
 * @return {Promise}
 */
function deleteParameter(name) {
  return new Promise((resolve, reject) => {
    let params = {
      Name: name
    };
    const ssm = new SSMClient(config.AWS.clientConfig);
    ssm.send(new DeleteParameterCommand(params), (err) => {
      if (err) {
        reject(err);
      } else {
        config.logger.info('Successfully deleted parameter: ' + params.Name);
        resolve(params.Name);
      }
    });
  });
}

module.exports = {
  putParameter,
  getParameter,
  checkParameter,
  deleteParameter
};
