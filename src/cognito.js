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
async function adminCreateUser(poolId, clientId, username, attributes) {
  let password = '!' + generator.generate({ length: 11, numbers: true, strict: true });
  let createUserParams = {
    UserPoolId: poolId,
    Username: username,
    MessageAction: 'SUPPRESS',
    TemporaryPassword: 'temp' + password,
    UserAttributes: attributes
  };

  const userPools = new CognitoIdentityProviderClient(config.AWS.clientConfig);
  const cognitoUser = await userPools.send(new AdminCreateUserCommand(createUserParams));

  let adminInitiateAuthParams = {
    AuthFlow: 'ADMIN_NO_SRP_AUTH',
    ClientId: clientId,
    UserPoolId: poolId,
    AuthParameters: {
      USERNAME: cognitoUser.User.Username,
      PASSWORD: 'temp' + password
    }
  };
  const initiateData = await userPools.send(new AdminInitiateAuthCommand(adminInitiateAuthParams));

  let adminChallengeResponse = {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: clientId,
    UserPoolId: poolId,
    ChallengeResponses: {
      USERNAME: cognitoUser.User.Username,
      NEW_PASSWORD: password
    },
    Session: initiateData.Session
  };
  await userPools.send(new AdminRespondToAuthChallengeCommand(adminChallengeResponse));

  return {
    user: cognitoUser,
    password: password
  };
}

/**
 * Update a user's attributes using admin flow.
 * @param poolId cognito user pool id
 * @param username username
 * @param attributes cognito user attributes
 * @return {Promise}
 */
async function adminUpdateUserAttributes(poolId, username, attributes) {
  let params = {
    UserAttributes: attributes,
    UserPoolId: poolId,
    Username: username
  };

  const userPools = new CognitoIdentityProviderClient(config.AWS.clientConfig);
  return await userPools.send(new AdminUpdateUserAttributesCommand(params));
}


module.exports = {
  adminUpdateUserAttributes,
  adminCreateUser
};
