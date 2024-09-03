const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig } = require("./stubs");
const {
  IAMClient,
  GetRoleCommand,
  GetUserCommand
} = require("@aws-sdk/client-iam");

// Rewire
const iam = rewire("../src/iam");

// iam Tests
describe("src/iam", () => {
  let stubs = [];

  // Mock iam Client
  let iamMock;

  beforeEach(() => {
    // Mock client
    iamMock = mockClient(IAMClient);
    // Mock config
    const configRestore = iam.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    iamMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // describeRole
  it("describes role", async () => {
    const name = "iam-role-name";

    // assert and resolve GetRoleCommand
    iamMock.on(GetRoleCommand).callsFake(input => {
      // assert
      expect(input).to.eql({ RoleName: name });

      // resolve
      return { Role: { RoleName: name } };
    });

    return expect(iam.describeRole(name)).to.eventually.deep.equal({ Role: { RoleName: name } });
  });

  // describeUser
  it("describes user", async () => {
    const name = "iam-user-name";

    // assert and resolve GetRoleCommand
    iamMock.on(GetUserCommand).callsFake(input => {
      // assert
      expect(input).to.eql({ UserName: name });

      // resolve
      return { User: { UserName: name } };
    });

    return expect(iam.describeUser(name)).to.eventually.deep.equal({ User: { UserName: name } });
  });

});