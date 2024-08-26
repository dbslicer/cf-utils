const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig } = require("./stubs");
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminUpdateUserAttributesCommand
} = require('@aws-sdk/client-cognito-identity-provider');

// Rewire
const cognito = rewire("../src/cognito");

// cognito Tests
describe("src/cognito", () => {
  let stubs = [];

  // Mock Cognito Client
  let cognitoMock;

  beforeEach(() => {
    // Mock client
    cognitoMock = mockClient(CognitoIdentityProviderClient);
    // Mock config
    const configRestore = cognito.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    cognitoMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // Admin Create User
  it("admin creates user", async () => {
    const poolId = "user-pool-id";
    const clientId = "client-id";
    const username = "cognito-username";
    const attributes = [
      { Name: "givenName", Value: "John" },
      { Name: "familyName", Value: "Doe" }
    ];
    const session = "session-string";

    // assert and resolve AdminCreateUserCommand
    cognitoMock.on(AdminCreateUserCommand).callsFake(input => {
      // assert
      expect(Object.keys(input)).to.have.members(["UserPoolId", "Username", "MessageAction", "TemporaryPassword", "UserAttributes"]);
      expect(input.UserPoolId).to.eql(poolId);
      expect(input.Username).to.eql(username);
      expect(input.MessageAction).to.eql("SUPPRESS");
      expect(input.TemporaryPassword).to.be.lengthOf(16);
      expect(input.TemporaryPassword.startsWith("temp")).to.be.true;
      expect(input.UserAttributes).to.eql(attributes);

      // resolve
      return { User: { Username: username } };
    });

    // assert and resolve AdminInitiateAuthCommand
    cognitoMock.on(AdminInitiateAuthCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["AuthFlow", "ClientId", "UserPoolId", "AuthParameters"]);
      expect(input.AuthFlow).to.eql("ADMIN_NO_SRP_AUTH");
      expect(input.ClientId).to.eql(clientId);
      expect(input.UserPoolId).to.eql(poolId);
      expect(Object.keys(input.AuthParameters)).to.have.members(["USERNAME", "PASSWORD"]);
      expect(input.AuthParameters.USERNAME).to.eql(username);
      expect(input.AuthParameters.PASSWORD).to.be.lengthOf(16);
      expect(input.AuthParameters.PASSWORD.startsWith("temp")).to.be.true;

      // resolve
      return { Session: session };
    });

    // assert and resolve AdminRespondToAuthChallengeCommand
    cognitoMock.on(AdminRespondToAuthChallengeCommand).callsFake(input => {
      expect(Object.keys(input)).to.have.members(["ChallengeName", "ClientId", "UserPoolId", "ChallengeResponses", "Session"]);
      expect(input.ChallengeName).to.eql("NEW_PASSWORD_REQUIRED");
      expect(input.ClientId).to.eql(clientId);
      expect(input.UserPoolId).to.eql(poolId);
      expect(Object.keys(input.ChallengeResponses)).to.have.members(["USERNAME", "NEW_PASSWORD"]);
      expect(input.ChallengeResponses.USERNAME).to.eql(username);
      expect(input.ChallengeResponses.NEW_PASSWORD).to.be.lengthOf(12);
      expect(input.Session).to.eql(session);

      // resolve
      return {};
    });

    const res = await cognito.adminCreateUser(poolId, clientId, username, attributes);
    expect(Object.keys(res)).to.have.members(["user", "password"]);
    expect(res.user).to.eql({ User: { Username: username } });
    expect(res.password).to.be.lengthOf(12);
  });

  // Admin Update User Attributes
  it("admin updates user attributes", async () => {
    const poolId = "user-pool-id";
    const username = "cognito-username";
    const attributes = [
      { Name: "givenName", Value: "John" },
      { Name: "familyName", Value: "Doe" }
    ];

    // assert and resolve AdminUpdateUserAttributesCommand
    cognitoMock.on(AdminUpdateUserAttributesCommand).callsFake(input => {
      // assert
      expect(Object.keys(input)).to.have.members(["UserAttributes", "UserPoolId", "Username"]);
      expect(input.UserAttributes).to.eql(attributes);
      expect(input.UserPoolId).to.eql(poolId);
      expect(input.Username).to.eql(username);

      // resolve
      return {};
    });

    return expect(cognito.adminUpdateUserAttributes(poolId, username, attributes)).to.eventually.deep.equal({});
  });

});