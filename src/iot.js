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
 * @param {Object} stackOutput output variables of a stack
 */
function updateIoTPolicies(stackOutput) {
  let promises = [];
  const iot = new IoTClient(config.AWS.clientConfig);
  Object.keys(stackOutput).forEach(outputKey => {
    if (outputKey.includes('IoTPolicyTemplate')) {
      promises.push(
        iot.send(new GetPolicyCommand({ policyName: stackOutput[outputKey] })).then((newPolicy) => {
          let policyToUpdate = stackOutput[outputKey.replace('Template', '')];
          _removeOldPolicyVersions(policyToUpdate, iot).then(() => {
            iot.send(
              new CreatePolicyVersionCommand({ policyName: policyToUpdate, policyDocument: newPolicy.policyDocument, setAsDefault: true })
            )
          })
        })
      );
    };
  });
  return Promise.all(promises)
}

/**
 * Removes all non-default policy versions from iot policy. IoT policies can only have a max of 5 policy versions
 * @param {String} policyName name of the iot policy
 * @param {Object} iot instance of AWS.IoT() to use
 */
function _removeOldPolicyVersions(policyName, iot) {
  return iot.send(new ListPolicyVersionsCommand({ policyName: policyName })).then((policies) => {
    if (policies.policyVersions.length > 1) {
      let promises = [];
      policies.policyVersions.forEach(policyVersion => {
        if (!policyVersion.isDefaultVersion) {
          promises.push(iot.send(new DeletePolicyVersionCommand({ policyName: policyName, policyVersionId: policyVersion.versionId })));
        };
      })
      return Promise.all(promises)
    }
    else {
      return Promise.resolve()
    };
  });
};


module.exports = {
  updateIoTPolicies
};
