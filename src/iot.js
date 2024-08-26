'use strict';
const config = require('./config');
const {
  IoTClient,
  GetPolicyCommand,
  CreatePolicyVersionCommand,
  ListPolicyVersionsCommand,
  DeletePolicyVersionCommand
} = require('@aws-sdk/client-iot');

/**
 * Updates the iot policies that match the naming convention
 * The output policy name key (with the updates) must be suffixed with 'IoTPolicyTemplate'
 * The output policy name key (to be updated) must have the same name as the policy with the updates with 'Template' removed (so suffixed with 'IoTPolicy')
 * @param {Object.<string, string>} stackOutput output variables of a stack
 */
async function updateIoTPolicies(stackOutput) {
  const iot = new IoTClient(config.AWS.clientConfig);

  const updatePolicy = async function (outputKey) {
    const newPolicy = await iot.send(new GetPolicyCommand({ policyName: stackOutput[outputKey] }));
    const policyToUpdate = stackOutput[outputKey.replace('Template', '')];
    await _removeOldPolicyVersions(policyToUpdate, iot);
    return await iot.send(
      new CreatePolicyVersionCommand({
        policyName: policyToUpdate,
        policyDocument: newPolicy.policyDocument,
        setAsDefault: true
      })
    );
  };

  const promises = [];
  Object.keys(stackOutput).forEach((outputKey) => {
    if (outputKey.includes('IoTPolicyTemplate')) {
      promises.push(updatePolicy(outputKey));
    }
  });

  return await Promise.all(promises);
}

/**
 * Removes all non-default policy versions from iot policy. IoT policies can only have a max of 5 policy versions
 * @param {String} policyName name of the iot policy
 * @param {Object} iot instance of AWS.IoT() to use
 */
async function _removeOldPolicyVersions(policyName, iot) {
  const policies = await iot.send(new ListPolicyVersionsCommand({ policyName: policyName }));
  if (policies.policyVersions.length > 1) {
    const promises = [];
    policies.policyVersions.forEach((policyVersion) => {
      if (!policyVersion.isDefaultVersion) {
        promises.push(iot.send(new DeletePolicyVersionCommand({
          policyName: policyName,
          policyVersionId: policyVersion.versionId
        })));
      }
    });

    return await Promise.all(promises);
  }
};


module.exports = {
  updateIoTPolicies
};
