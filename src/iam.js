'use strict';
const config = require('./config');
const {
  IAMClient,
  GetRoleCommand,
  GetUserCommand
} = require("@aws-sdk/client-iam");

function describeRole(name) {
  return new Promise((resolve, reject) => {
    const iam = new IAMClient(config.AWS.clientConfig);
    var params = {
      RoleName: name
    };
    iam.send(new GetRoleCommand(params), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

function describeUser(name) {
  return new Promise((resolve, reject) => {
    const iam = new IAMClient(config.AWS.clientConfig);
    var params = {
      UserName: name
    };
    iam.send(new GetUserCommand(params), (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}


module.exports = {
  describeRole,
  describeUser
};
