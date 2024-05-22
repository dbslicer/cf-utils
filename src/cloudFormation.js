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
function upsertStack(name, script, parameters, options) {
  if (typeof options === "boolean") { // To maintain backwards compatibility
    options = { review: options };
  } else {
    options = options || {};
  }

  let containsTransforms = options.hasOwnProperty('containsTransforms') ?
    options.containsTransforms : /Transform\"?\s*:\s*\"?AWS::Serverless/.test(fs.readFileSync(script, 'utf-8'));

  if (options.s3Bucket) {
    return s3.putS3Object({
      Bucket: options.s3Bucket,
      Key: `${options.s3Prefix}${script}`,
      Body: fs.createReadStream(script)
    }).then(() =>
      upsertStack(
        name,
        `https://s3.amazonaws.com/${options.s3Bucket}/${options.s3Prefix}${script}`,
        parameters,
        { review: options.review === true, containsTransforms: containsTransforms }
      )
    );
  }

  return new Promise((resolve, reject) => {
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
        reject(new Error(`${script} does not exist!`));
        return;
      }
      params.TemplateBody = fs.readFileSync(script).toString();
    }


    let executeUpdate = function () {
      return new Promise((resolve, reject) => {
        if (containsTransforms) {
          config.logger.info('Stack contains transforms, deploying via change set...');
          delete params.DisableRollback;
          resolve(applyChangeSet(Object.assign({}, params, {
            ChangeSetName: generateChangeSetName(),
            ChangeSetType: 'UPDATE'
          }))
          );
        } else {
          return updateStack(params)
            .then(data => resolve(data))
            .catch(err => reject(err))
        }
      });
    };


    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new DescribeStacksCommand({ StackName: name }), (err) => {
      if (err) {
        if (containsTransforms) {
          config.logger.info('Stack contains transforms, deploying via change set...');
          delete params.DisableRollback;
          resolve(applyChangeSet(Object.assign({}, params, {
            ChangeSetName: generateChangeSetName(),
            ChangeSetType: 'CREATE'
          }))
          );
        } else {
          createStack(params)
            .then(result => {
              resolve(result);
            })
            .catch((err) => {
              reject(err);
            });
        }
      } else {
        if (options.review) {
          config.logger.info('Stack exists, creating changeset for review...');
          let csParams = {
            StackName: params.StackName,
            ChangeSetName: 'cf-utils-' + params.StackName + '-preview'
          };
          createChangeSet(Object.assign({}, params, csParams))
            .then(cs => {
              if (cs) {
                config.logger.info({ ChangeSet: cs });
                inquirer.prompt(
                  [{
                    type: 'confirm',
                    name: 'performUpdate',
                    message: 'Changes will be made to these resources. Do you want to update stack?',
                    default: false
                  }])
                  .then(response => {
                    config.logger.info('Cleaning up review change set....');
                    deleteChangeSet(csParams)
                      .then(() => {
                        if (response.performUpdate) {
                          config.logger.info('Reviewer has accepted updates, continuing with stack update...');
                          resolve(executeUpdate());
                        } else {
                          reject('Reviewer rejected stack update');
                        }
                      });
                  });
              } else {
                config.logger.info('There are no changes to apply, continuing....');
                resolve(pollStack(params));
              }
            });
        } else {
          config.logger.info('Stack exists, updating...');
          resolve(executeUpdate());
        }
      }
    });
  });
}

/**
 * Create a stack
 * @param params AWS createStack params
 * @return {Promise}
 */
function createStack(params) {
  return new Promise((resolve, reject) => {
    params.DisableRollback = true;
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new CreateStackCommand(params), (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(pollStack(params));
      }
    })
  });
}

/**
 * Update a stack
 * @param params AWS updateStack params
 * @return {Promise}
 */
function updateStack(params) {
  return new Promise((resolve, reject) => {
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new UpdateStackCommand(params), (err) => {
      if (err) {
        if (err.toString().indexOf('No updates are to be performed') >= 0) {
          config.logger.info('There are no changes to apply, continuing....');
        } else {
          reject(err);
          return;
        }
      }
      resolve(pollStack(params));
    })
  });
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
function applyChangeSet(params) {
  return createChangeSet(params)
    .then((cs) => {
      if (cs) {
        let csParams = {
          StackName: cs.StackName, ChangeSetName: cs.ChangeSetName
        };
        return executeChangeSet(csParams);
      }
    });
}

/**
 * Create a change set for the specified stack
 * @param params AWS createChangeSet params
 * @return {Promise}
 */
function createChangeSet(params) {
  return new Promise((resolve, reject) => {
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new CreateChangeSetCommand(params), (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(pollChangeSet(params));
      }
    })
  });
}

/**
 * Execute the specified change set for the underlying stack
 * @param params AWS executeChangeSet params
 * @return {Promise}
 */
function executeChangeSet(params) {
  return new Promise((resolve, reject) => {
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new ExecuteChangeSetCommand(params), (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(pollStack(params));
      }
    })
  });
}

/**
 * Deploy stack with transforms using CLI.
 * @param name fully qualified stack name
 * @param script full path to stack template
 * @param parameters complete listing of stack inputs
 * @return {Promise}
 */
function deployStack(name, script, parameters) {
  return new Promise((resolve, reject) => {
    let params = '';
    if (parameters && parameters.length > 0) {
      for (let i = 0; i < parameters.length; i++) {
        params += `${parameters[i].ParameterKey}="${parameters[i].ParameterValue}" `;
      }
    }

    const cli = spawn('aws',
      [
        'cloudformation',         'deploy',
        '--profile',              config.AWS_PROFILE,
        '--region',               config.AWS_REGION,
        '--template-file',        script,
        '--stack-name',           name,
        '--capabilities',         'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM',
        ' --parameter-overrides', params
      ],
      { shell: true }
    );

    let err = '';
    cli.stdout.setEncoding('utf8'); cli.stderr.setEncoding('utf8');
    cli.stdout.on('data', (data) => { console.log(data); });
    cli.stderr.on('data', (data) => { console.log(data); err += data; });
    cli.on('close', (code) => {
      if (code !== 0) {
        if (err.indexOf('No changes to deploy') >= 0) {
          config.logger.info('There are no changes to apply, continuing....');
        } else {
          reject('Stack deploy failed');
          return;
        }
      }
      resolve(describeStack(name));
    });
  });
}

/**
 * Describe stack
 * @param name fully qualified stack name
 * @return {Promise}
 */
function describeStack(name) {
  return new Promise((resolve, reject) => {
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new DescribeStacksCommand({ StackName: name }), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.Stacks[0]);
      }
    });
  });
}

/**
 * Extract the outputs for the specified stack
 * @param name fully qualified stack name
 * @return {Promise.<TResult>}
 */
function describeOutput(name) {
  return describeStack(name)
    .then(data => extractOutput(data));
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
function deleteStack(name) {
  return new Promise((resolve, reject) => {
    let params = {
      StackName: name
    };
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new DescribeStacksCommand({ StackName: name }), (err, data) => {
      if (err) {
        if (err.message.indexOf('does not exist')) {
          config.logger.info('Stack already deleted or never existed.');
          resolve();
        }
        reject(err);
      } else {
        // Check for any S3 buckets and if found empty each bucket otherwise delete stack operation will fail
        let s3Operations = [];
        if (data.Stacks[0].Outputs !== undefined) {
          for (let i = 0; i < data.Stacks[0].Outputs.length; i++) {
            if (/.*Bucket$/.test(data.Stacks[0].Outputs[i].OutputKey)) {
              s3Operations.push(new Promise((resolve) => {
                config.logger.info('Emptying S3 bucket', data.Stacks[0].Outputs[i].OutputValue);
                resolve(s3.emptyBucket(data.Stacks[0].Outputs[i].OutputValue));
              }))
            }
          }
        }

        Promise.all(s3Operations)
          .then(() => {
            return cf.send(new DeleteStackCommand(params), (err) => {
              if (err) {
                reject(err);
              } else {
                resolve(pollStack(params));
              }
            });
          })
          .catch(err => reject(err));
      }
    });
  });
}

/**
 * Delete change set
 * @param params AWS deleteChangeSet params
 * @return {Promise}
 */
function deleteChangeSet(params) {
  return new Promise((resolve, reject) => {
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new DeleteChangeSetCommand(params), (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(pollChangeSet(params));
      }
    });
  });
}

/**
 * Poll stack status. Used to wait for stack operations to complete.
 * @param params AWS updateStack/createStack params
 * @return {Promise}
 */
function pollStack(params) {
  return new Promise((resolve, reject) => {
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new DescribeStacksCommand({ StackName: params.StackName }), (err, data) => {
      if (err) {
        if (err.message.indexOf('does not exist') >= 0) {
          config.logger.info('Stack deleted or never existed.');
          resolve();
        } else {
          reject(err);
        }
      } else {
        let stack = data.Stacks[0];
        switch (stack.StackStatus) {
          case 'CREATE_COMPLETE':
          case 'UPDATE_COMPLETE':
            config.logger.info('Stack operation completed');
            resolve(data);
            return;
          case 'ROLLBACK_COMPLETE':
          case 'CREATE_FAILED':
          case 'UPDATE_FAILED':
          case 'DELETE_FAILED':
          case 'UPDATE_ROLLBACK_COMPLETE':
            config.logger.warn({ StackDetails: data });
            reject(new Error('Stack operation failed'));
            return;
        }
        config.logger.info('Waiting for stack operation to complete. This may take some time - ' + stack.StackStatus);
        setTimeout(function () {
          resolve(pollStack(params));
        }, 5000);
      }
    });
  });
}

/**
 * Poll stack change set status. Used to wait for stack operations to complete.
 * @param params AWS updateStack params
 * @param params
 * @return {Promise}
 */
function pollChangeSet(params) {
  return new Promise((resolve, reject) => {
    const cf = new CloudFormationClient(config.AWS.clientConfig);
    cf.send(new DescribeChangeSetCommand({
      ChangeSetName: params.ChangeSetName, StackName: params.StackName
    }), (err, cs) => {
      if (err) {
        if (err.message.indexOf('does not exist') >= 0) {
          config.logger.info('Change set deleted or never existed.');
          resolve();
        } else {
          reject(err);
        }
      } else {
        switch (cs.Status) {
          case 'CREATE_COMPLETE':
            config.logger.info('Change set created');
          case 'UPDATE_COMPLETE':
          case 'DELETE_COMPLETE':
            resolve(cs);
            return;
          case 'FAILED':
            if (cs.StatusReason.indexOf("No updates are to be performed") >= 0 ||
              cs.StatusReason.indexOf("didn't contain changes") >= 0) {
              config.logger.info('No updates are to be performed');
              resolve();
            } else {
              config.logger.warn({ ChangeSet: cs });
              reject(new Error('Changeset creation failed'));
            }
            return;
        }
        config.logger.info('Waiting for change set to be created - ' + cs.Status);
        setTimeout(function () {
          resolve(pollChangeSet(params));
        }, 5000);
      }
    });
  });
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
