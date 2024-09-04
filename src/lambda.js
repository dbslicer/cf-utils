'use strict';
const config = require('./config');
const {
  LambdaClient,
  ListFunctionsCommand,
  UpdateFunctionCodeCommand,
  InvokeCommand
} = require('@aws-sdk/client-lambda');

/**
 * List the lambdas that match the specified filter
 * @param filter string pattern to match
 * @param continuationToken continue listing from this marker
 * @returns {Promise}
 */
async function listFunctions(filter, continuationToken) {
  const lambda = new LambdaClient(config.AWS.clientConfig);
  let params = {
    Marker: continuationToken
  };

  const data = await lambda.send(new ListFunctionsCommand(params));
  if (data && data.Functions) {
    data.Functions = data.Functions.filter(lambda => lambda.FunctionName.includes(filter))
  }
  return data;
}


/**
 * Update the code for the specified lambda
 * @param params AWS updateFunctionCode params
 * @return {Promise}
 */
async function updateFunctionCode(params) {
  const lambda = new LambdaClient(config.AWS.clientConfig);
  const data = await lambda.send(new UpdateFunctionCodeCommand(params));
  config.logger.info('Updated Lambda function: ', params.FunctionName);
  return data;
}


/**
 * Update the code for all the functions that match the specified filter
 * @param filter string pattern to match
 * @param params AWS updateFunctionCode params (note: FunctionName should not be specified)
 */
async function updateFunctionsCode(filter, params) {
  const listAndUpdate = async function (continuationToken) {
    const data = await listFunctions(filter, continuationToken);
    if (data && data.Functions && data.Functions.length > 0) {
      await Promise.all(
        data.Functions.map((lambda) =>
          new Promise((resolve) => resolve(updateFunctionCode(
            Object.assign({}, params, { FunctionName: lambda.FunctionName }))))
        ));
    }

    const nextToken = data ? data.NextMarker : null;
    if (nextToken) {
      return await listAndUpdate(nextToken);
    }
  };

  await listAndUpdate();
}


/**
 * Invoke the specified lambda
 * @param name function name
 * @param input input json
 * @param context [optional] client context details
 * @return {Promise}
 */
async function invokeFunction(name, input, context) {
  let params = {
    FunctionName: name,
    Payload: typeof input !== 'string' ? JSON.stringify(input) : input,
    ClientContext: context
  };

  const lambda = new LambdaClient(config.AWS.clientConfig);
  config.logger.info('Invoking Lambda function:', params.FunctionName);

  const data = await lambda.send(new InvokeCommand(params));
  config.logger.info('Result (Status Code:', data.StatusCode, '):');
  config.logger.info({ Payload: JSON.parse(Buffer.from(data.Payload).toString()) });
  return data;
}


module.exports = {
  listFunctions,
  invokeFunction,
  updateFunctionCode,
  updateFunctionsCode
};
