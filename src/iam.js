'use strict';
const config = require('./config');
const {
  IAMClient,
  GetRoleCommand,
  GetUserCommand
} = require("@aws-sdk/client-iam");

async function describeRole(name) {
  const iam = new IAMClient(config.AWS.clientConfig);
  var params = {
    RoleName: name
  };
  return await iam.send(new GetRoleCommand(params));
}

async function describeUser(name) {
  const iam = new IAMClient(config.AWS.clientConfig);
  var params = {
    UserName: name
  };
  return await iam.send(new GetUserCommand(params));
}


module.exports = {
  describeRole,
  describeUser
};
