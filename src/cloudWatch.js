'use strict';
const config = require('./config');
const {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DeleteLogGroupCommand
} = require("@aws-sdk/client-cloudwatch-logs");

/**
 * List the log groups that match the specified filter
 * @param filter string pattern to match
 * @param continuationToken continue listing from this marker
 * @returns {Promise}
 */
async function listLogGroups(filter, continuationToken) {
  const cw = new CloudWatchLogsClient(config.AWS.clientConfig);
  let params = {
    logGroupNamePrefix: filter,
    nextToken: continuationToken
  };

  return await cw.send(new DescribeLogGroupsCommand(params));
}

/**
 * Delete the specified log group
 * @param name the name of the log group
 * @return {Promise}
 */
async function deleteLogGroup(name) {
  let params = {
    logGroupName: name
  };
  const cw = new CloudWatchLogsClient(config.AWS.clientConfig);
  return await cw.send(new DeleteLogGroupCommand(params));
}

/**
 * Delete all the log groups that match the specified filter
 * @param filter string pattern to match
 * @returns {Promise}
 */
async function deleteLogGroups(filter) {
  let listAndDelete = async function (continuationToken) {
    const data = await listLogGroups(filter, continuationToken);
    if (data && data.logGroups && data.logGroups.length > 0) {
      await Promise.all(data.logGroups.map((log) => deleteLogGroup(log.logGroupName)));
    }

    const nextToken = data ? data.nextToken : null;
    if (nextToken) {
      return await listAndDelete(nextToken);
    }
  };

  await listAndDelete();
}


module.exports = {
  listLogGroups,
  deleteLogGroup,
  deleteLogGroups
};
