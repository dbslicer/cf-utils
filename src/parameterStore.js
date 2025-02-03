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
async function putParameter(params) {
  const ssm = new SSMClient(config.AWS.clientConfig);
  await ssm.send(new PutParameterCommand(params));
  config.logger.info('Successfully upserted parameter: ' + params.Name);
  return params.Name;
}

/**
 * Retrieve the value of the specified parameter
 * @param name name of the parameter
 * @return {Promise}
 */
async function getParameter(name) {
  let params = {
    Names: [name],
    WithDecryption: true
  };
  const ssm = new SSMClient(config.AWS.clientConfig);
  const data = await ssm.send(new GetParametersCommand(params));

  if (data.Parameters && data.Parameters.length > 0) {
    config.logger.info('Successfully retrieved parameter: ' + params.Names[0]);
    return data.Parameters[0];
  } else {
    throw new Error("Parameter not found");
  }
}

/**
 * Check if the specified parameter exists
 * @param name
 * @return {Promise}
 */
async function checkParameter(name) {
  let params = {
    Names: [name]
  };
  const ssm = new SSMClient(config.AWS.clientConfig);
  const data = await ssm.send(new GetParametersCommand(params));
  return data.Parameters ? data.Parameters.length > 0 : false;
}

/**
 * Delete the specified parameter
 * @param name name of the parameter
 * @return {Promise}
 */
async function deleteParameter(name) {
  let params = {
    Name: name
  };
  const ssm = new SSMClient(config.AWS.clientConfig);
  await ssm.send(new DeleteParameterCommand(params));

  config.logger.info('Successfully deleted parameter: ' + params.Name);
  return params.Name;
}

module.exports = {
  putParameter,
  getParameter,
  checkParameter,
  deleteParameter
};
