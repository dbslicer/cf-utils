'use strict';
const config = require('./config');
const s3 = require('./s3');
const fs = require('fs');
const inquirer = require('inquirer');
const { spawn } = require('child_process');
const {
  CloudFormationClient,
  DescribeStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
  CreateChangeSetCommand,
  ExecuteChangeSetCommand,
  DeleteChangeSetCommand,
  DescribeChangeSetCommand,
  DeleteStackCommand
} = require('@aws-sdk/client-cloudformation');

/**
 * Poll changeset timeout in milliseconds
 */
const POLL_TIMEOUT = 5000;

/**
 * Create/Update a stack. Automatically switches to change sets if stack contains transforms (e.g. SAM)
 * <p>
 * Note: options was previously 'review'. To keep backwards compatibility this
 * method will continue to accept a boolean value for this parameter.
 * Possible options:<br>
 * {<br>
 *    review   : boolean // If stack exists and this is true, then generate change set and pause update pending reviewer direction.<br>
 *    s3Bucket : string  // If this is set then the specified script will be uploaded to S3 and the TemplateURL will be used instead of TemplateBody.<br>
 *    s3Prefix : string  // [optional] Used if s3Bucket is specified.<br>
 * }<br>
 * </p>
 * @param name fully qualified stack name
 * @param script path to stack template
 * @param parameters complete listing of stack inputs
 * @param options upsert options  (review, s3Bucket, s3Prefix)
 * @return {Promise}
 */
async function upsertStack(name, script, parameters, options) {
  if (typeof options === "boolean") { // To maintain backwards compatibility
    options = { review: options };
  } else {
    options = options || {};
  }

  let containsTransforms = options.hasOwnProperty('containsTransforms')
    ? options.containsTransforms
    : /Transform\"?\s*:\s*\"?AWS::Serverless/.test(fs.readFileSync(script, 'utf-8'));

  if (options.s3Bucket) {
    await s3.putS3Object({
      Bucket: options.s3Bucket,
      Key: `${options.s3Prefix}${script}`,
      Body: fs.createReadStream(script)
    });
    return await upsertStack(
      name,
      `https://s3.amazonaws.com/${options.s3Bucket}/${options.s3Prefix}${script}`,
      parameters,
      { review: options.review === true, containsTransforms: containsTransforms }
    );
  }

  let params = {
    StackName: name,
    Capabilities: [
      'CAPABILITY_IAM',
      'CAPABILITY_NAMED_IAM',
      'CAPABILITY_AUTO_EXPAND'
    ],
    Parameters: parameters
  };

  if (script.substring(0, 10) === 'https://s3') {
    params.TemplateURL = script;
  } else {
    if (!fs.existsSync(script)) {
      throw new Error(`${script} does not exist!`);
    }
    params.TemplateBody = fs.readFileSync(script).toString();
  }

  const executeUpdate = async function () {
    if (containsTransforms) {
      config.logger.info('Stack contains transforms, deploying via change set...');
      delete params.DisableRollback;
      return await applyChangeSet(Object.assign({},
        params,
        {
          ChangeSetName: generateChangeSetName(),
          ChangeSetType: 'UPDATE'
        }
      ));
    } else {
      return await updateStack(params);
    }
  };

  const cf = new CloudFormationClient(config.AWS.clientConfig);

  try {
    await cf.send(new DescribeStacksCommand({ StackName: name }));
  } catch (err) {
    if (containsTransforms) {
      config.logger.info('Stack contains transforms, deploying via change set...');
      delete params.DisableRollback;
      return await applyChangeSet(Object.assign({},
        params,
        {
          ChangeSetName: generateChangeSetName(),
          ChangeSetType: 'CREATE'
        }
      ));
    } else {
      return await createStack(params);
    }
  }

  if (options.review) {
    config.logger.info('Stack exists, creating changeset for review...');
    let csParams = {
      StackName: params.StackName,
      ChangeSetName: 'cf-utils-' + params.StackName + '-preview'
    };
    const cs = await createChangeSet(Object.assign({}, params, csParams));
    if (cs) {
      config.logger.info({ ChangeSet: cs });
      const response = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'performUpdate',
          message: 'Changes will be made to these resources. Do you want to update stack?',
          default: false
        }
      ]);
      config.logger.info('Cleaning up review change set....');
      await deleteChangeSet(csParams);
      if (response.performUpdate) {
        config.logger.info('Reviewer has accepted updates, continuing with stack update...');
        return await executeUpdate();
      } else {
        throw new Error('Reviewer rejected stack update');
      }
    } else {
      config.logger.info('There are no changes to apply, continuing....');
      return await pollStack(params);
    }
  } else {
    config.logger.info('Stack exists, updating...');
    return await executeUpdate();
  }
}

/**
 * Create a stack
 * @param params AWS createStack params
 * @return {Promise}
 */
async function createStack(params) {
  params.DisableRollback = true;
  const cf = new CloudFormationClient(config.AWS.clientConfig);
  await cf.send(new CreateStackCommand(params));
  return await pollStack(params);
}

/**
 * Update a stack
 * @param params AWS updateStack params
 * @return {Promise}
 */
async function updateStack(params) {
  const cf = new CloudFormationClient(config.AWS.clientConfig);
  try {
    await cf.send(new UpdateStackCommand(params));
  } catch (err) {
    if (err.toString().indexOf('No updates are to be performed') >= 0) {
      config.logger.info('There are no changes to apply, continuing....');
    } else {
      throw err;
    }
  }
  return await pollStack(params);
}


/**
 * Utility method to generate a unique change set name
 * @param name stack name
 */
function generateChangeSetName() {
  return 'cf-utils-cloudformation-upsert-stack-' + (Date.now() / 1000 | 0);
}

/**
 * Update a stack by creating and executing a change set (used with templates with transforms)
 * @param params AWS createChangeSet params
 */
async function applyChangeSet(params) {
  const cs = await createChangeSet(params);
  if (cs) {
    let csParams = {
      StackName: cs.StackName, ChangeSetName: cs.ChangeSetName
    };
    return await executeChangeSet(csParams);
  }
}

/**
 * Create a change set for the specified stack
 * @param params AWS createChangeSet params
 * @return {Promise}
 */
async function createChangeSet(params) {
  const cf = new CloudFormationClient(config.AWS.clientConfig);
  await cf.send(new CreateChangeSetCommand(params));
  return await pollChangeSet(params);
}

/**
 * Execute the specified change set for the underlying stack
 * @param params AWS executeChangeSet params
 * @return {Promise}
 */
async function executeChangeSet(params) {
  const cf = new CloudFormationClient(config.AWS.clientConfig);
  await cf.send(new ExecuteChangeSetCommand(params));
  return await pollStack(params);
}

/**
 * Deploy stack with transforms using CLI.
 * @param name fully qualified stack name
 * @param script full path to stack template
 * @param parameters complete listing of stack inputs
 * @return {Promise}
 */
async function deployStack(name, script, parameters) {
  let params = '';
  if (parameters && parameters.length > 0) {
    for (let i = 0; i < parameters.length; i++) {
      params += `${parameters[i].ParameterKey}="${parameters[i].ParameterValue}" `;
    }
  }

  const cli = spawn('aws',
    [
      'cloudformation', 'deploy',
      '--profile', config.AWS_PROFILE,
      '--region', config.AWS_REGION,
      '--template-file', script,
      '--stack-name', name,
      '--capabilities', 'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM',
      ' --parameter-overrides', params
    ],
    { shell: true }
  );

  let err = '';
  cli.stdout.setEncoding('utf8'); cli.stderr.setEncoding('utf8');
  cli.stdout.on('data', (data) => { console.log(data); });
  cli.stderr.on('data', (data) => { console.log(data); err += data; });
  await new Promise((resolve, reject) => {
    cli.on('close', (code) => {
      if (code !== 0) {
        if (err.indexOf('No changes to deploy') >= 0) {
          config.logger.info('There are no changes to apply, continuing....');
        } else {
          reject('Stack deploy failed');
          return;
        }
      }
      resolve();
    });
  });

  return await describeStack(name);
}

/**
 * Describe stack
 * @param name fully qualified stack name
 * @return {Promise}
 */
async function describeStack(name) {
  const cf = new CloudFormationClient(config.AWS.clientConfig);
  const data = await cf.send(new DescribeStacksCommand({ StackName: name }));
  return data.Stacks[0];
}

/**
 * Extract the outputs for the specified stack
 * @param name fully qualified stack name
 * @return {Promise.<TResult>}
 */
async function describeOutput(name) {
  const data = await describeStack(name);
  return extractOutput(data);
}

/**
 * Extract the outputs from a stack
 * @param stack stack details
 * @return {Promise.<TResult>}
 */
function extractOutput(stack) {
  return stack.Outputs.reduce((map, output) => {
    map[output.OutputKey] = output.OutputValue; return map;
  }, {});
}

/**
 * Delete a stack (note: will automatically empty S3 buckets before running deleteStack operation)
 * @param name fully qualified stack name
 * @return {Promise}
 */
async function deleteStack(name) {
  let params = {
    StackName: name
  };

  const cf = new CloudFormationClient(config.AWS.clientConfig);

  let data;
  try {
    data = await cf.send(new DescribeStacksCommand({ StackName: name }));
  } catch (err) {
    if (err.message.includes('does not exist')) {
      config.logger.info('Stack already deleted or never existed.');
      return;
    }
    throw err;
  }

  // Check for any S3 buckets and if found empty each bucket otherwise delete stack operation will fail
  let s3Operations = [];
  if (data.Stacks[0].Outputs !== undefined) {
    for (let i = 0; i < data.Stacks[0].Outputs.length; i++) {
      if (/.*Bucket$/.test(data.Stacks[0].Outputs[i].OutputKey)) {
        s3Operations.push(new Promise(resolve => {
          config.logger.info('Emptying S3 bucket', data.Stacks[0].Outputs[i].OutputValue);
          resolve(s3.emptyBucket(data.Stacks[0].Outputs[i].OutputValue));
        }));
      }
    }
  }

  // Empty buckets
  await Promise.all(s3Operations);

  // Delete stack
  await cf.send(new DeleteStackCommand(params));
  return await pollStack(params);
}

/**
 * Delete change set
 * @param params AWS deleteChangeSet params
 * @return {Promise}
 */
async function deleteChangeSet(params) {
  const cf = new CloudFormationClient(config.AWS.clientConfig);
  await cf.send(new DeleteChangeSetCommand(params));
  return await pollChangeSet(params);
}

/**
 * Poll stack status. Used to wait for stack operations to complete.
 * @param params AWS updateStack/createStack params
 * @return {Promise}
 */
async function pollStack(params) {
  const cf = new CloudFormationClient(config.AWS.clientConfig);

  let data;
  try {
    data = await cf.send(new DescribeStacksCommand({ StackName: params.StackName }));
  } catch (err) {
    if (err.message.indexOf('does not exist') >= 0) {
      config.logger.info('Stack deleted or never existed.');
      return;
    } else {
      throw err
    }
  }

  let stack = data.Stacks[0];
  switch (stack.StackStatus) {
    case 'CREATE_COMPLETE':
    case 'UPDATE_COMPLETE':
      config.logger.info('Stack operation completed');
      return data;
    case 'ROLLBACK_COMPLETE':
    case 'CREATE_FAILED':
    case 'UPDATE_FAILED':
    case 'DELETE_FAILED':
    case 'UPDATE_ROLLBACK_COMPLETE':
      config.logger.warn({ StackDetails: data });
      throw new Error('Stack operation failed');
  }
  config.logger.info('Waiting for stack operation to complete. This may take some time - ' + stack.StackStatus);

  return await new Promise(resolve => setTimeout(function () {
    resolve(pollStack(params));
  }, POLL_TIMEOUT));
}

/**
 * Poll stack change set status. Used to wait for stack operations to complete.
 * @param params AWS updateStack params
 * @param params
 * @return {Promise}
 */
async function pollChangeSet(params) {
  const cf = new CloudFormationClient(config.AWS.clientConfig);

  let cs;
  try {
    cs = await cf.send(new DescribeChangeSetCommand({
      ChangeSetName: params.ChangeSetName, StackName: params.StackName
    }));
  } catch (err) {
    if (err.message.indexOf('does not exist') >= 0) {
      config.logger.info('Change set deleted or never existed.');
      return;
    } else {
      throw err;
    }
  }

  switch (cs.Status) {
    case 'CREATE_COMPLETE':
      config.logger.info('Change set created');
    case 'UPDATE_COMPLETE':
    case 'DELETE_COMPLETE':
      return cs;
    case 'FAILED':
      if (
        cs.StatusReason.indexOf("No updates are to be performed") >= 0 ||
        cs.StatusReason.indexOf("didn't contain changes") >= 0
      ) {
        config.logger.info('No updates are to be performed');
        return;
      } else {
        config.logger.warn({ ChangeSet: cs });
        throw new Error('Changeset creation failed');
      }
  }
  config.logger.info('Waiting for change set to be created - ' + cs.Status);

  return await new Promise(resolve => setTimeout(function () {
    resolve(pollChangeSet(params));
  }, POLL_TIMEOUT));
}


module.exports = {
  upsertStack,
  createStack,
  updateStack,
  deployStack,
  describeStack,
  describeOutput,
  extractOutput,
  deleteStack,
  pollStack,
  pollChangeSet,
  createChangeSet,
  deleteChangeSet,
};
