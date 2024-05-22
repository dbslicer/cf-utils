'use strict';
const config = require('./config');
const generator = require('generate-password');
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminUpdateUserAttributesCommand
} = require('@aws-sdk/client-cognito-identity-provider');

/**
 * Create a new user using the admin auth flow
 * @param poolId cognito user pool id
 * @param clientId cognito application id
 * @param username username
 * @param attributes cognito user attributes
 * @return {Promise}
 */
function adminCreateUser(poolId, clientId, username, attributes) {
  return new Promise((resolve, reject) => {
    let password = '!' + generator.generate({ length: 11, numbers: true, strict: true });
    let createUserParams = {
      UserPoolId: poolId,
      Username: username,
      MessageAction: 'SUPPRESS',
      TemporaryPassword: 'temp' + password,
      UserAttributes: attributes
    };

    const userPools = new CognitoIdentityProviderClient(config.AWS.clientConfig);
    userPools.send(new AdminCreateUserCommand(createUserParams), (err, cognitoUser) => {
      if (err) {
        reject(err);
      } else {
        let adminInitiateAuthParams = {
          AuthFlow: 'ADMIN_NO_SRP_AUTH',
          ClientId: clientId,
          UserPoolId: poolId,
          AuthParameters: {
            USERNAME: cognitoUser.User.Username,
            PASSWORD: 'temp' + password
          }
        };
        userPools.send(new AdminInitiateAuthCommand(adminInitiateAuthParams), (err, data) => {
          if (err) {
            reject(err);
          } else {
            let adminChallengeResponse = {
              ChallengeName: 'NEW_PASSWORD_REQUIRED',
              ClientId: clientId,
              UserPoolId: poolId,
              ChallengeResponses: {
                USERNAME: cognitoUser.User.Username,
                NEW_PASSWORD: password
              },
              Session: data.Session
            };
            userPools.send(new AdminRespondToAuthChallengeCommand(adminChallengeResponse), (err, data) => {
              if (err) {
                reject(err);
              } else {
                resolve({
                  user: cognitoUser,
                  password: password
                });
              }
            });
          }
        });
      }
    });
  });
}

/**
 * Update a user's attributes using admin flow.
 * @param poolId cognito user pool id
 * @param username username
 * @param attributes cognito user attributes
 * @return {Promise}
 */
function adminUpdateUserAttributes(poolId, username, attributes) {
  return new Promise((resolve, reject) => {
    let params = {
      UserAttributes: attributes,
      UserPoolId: poolId,
      Username: username
    };

    const userPools = new CognitoIdentityProviderClient(config.AWS.clientConfig);
    userPools.send(new AdminUpdateUserAttributesCommand(params), (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    })
  });
}


module.exports = {
  adminUpdateUserAttributes,
  adminCreateUser
};
