const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig } = require("./stubs");
const {
  SSMClient,
  PutParameterCommand,
  GetParametersCommand,
  DeleteParameterCommand
} = require('@aws-sdk/client-ssm');

// Rewire
const parameterStore = rewire("../src/parameterStore");

// Parameter Store Tests
describe("src/parameterStore", () => {
  let stubs = [];

  // Mock SSM Client
  let ssmMock;

  beforeEach(() => {
    // Mock client
    ssmMock = mockClient(SSMClient);
    // Mock config
    const configRestore = parameterStore.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    ssmMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // Put Parameter
  it("puts parameter", async () => {
    const param = {
      Name: "ssm-param-name",
      Value: "SOME_VALUE"
    };

    ssmMock.on(PutParameterCommand).callsFake(input => {
      expect(input).to.eql(param);
      return {};
    });

    return expect(parameterStore.putParameter(param)).to.eventually.deep.equal(param.Name);
  });

  describe("get parameter", () => {
    // Get Parameter
    it("gets parameter", async () => {
      const param = {
        Name: "ssm-param-name",
        Value: "SOME_VALUE"
      };

      ssmMock.on(GetParametersCommand).callsFake(input => {
        expect(input).to.eql({
          Names: [param.Name],
          WithDecryption: true
        });
        return { Parameters: [param] };
      });

      return expect(parameterStore.getParameter(param.Name)).to.eventually.deep.equal(param);
    });

    // Parameter not found
    it("parameter not found", async () => {
      const param = {
        Name: "ssm-param-name",
        Value: "SOME_VALUE"
      };

      ssmMock.on(GetParametersCommand)
        .resolvesOnce({ Parameters: [] })
        .resolvesOnce({});

      await expect(parameterStore.getParameter(param.Name)).to.eventually.be.rejectedWith("Parameter not found");

      await expect(parameterStore.getParameter(param.Name)).to.eventually.be.rejectedWith("Parameter not found");
    });
  });

  // Check Parameter
  describe("check parameter", () => {

    // Finds parameter
    it("parameter found", async () => {
      const param = {
        Name: "ssm-param-name",
        Value: "SOME_VALUE"
      };

      ssmMock.on(GetParametersCommand).callsFake(input => {
        expect(input).to.eql({ Names: [param.Name] });
        return { Parameters: [param] };
      });

      return expect(parameterStore.checkParameter(param.Name)).to.eventually.be.true;
    });

    // Cannot find parameter
    it("parameter not found", async () => {
      const param = {
        Name: "ssm-param-name",
        Value: "SOME_VALUE"
      };

      ssmMock.on(GetParametersCommand)
        .resolvesOnce({ Parameters: [] })
        .resolvesOnce({});

      parameterStore.checkParameter(param.Name)
        .then(res => {
          expect(res).to.be.false;
        })
        .catch(err => {
          done(err);
        });

      return expect(parameterStore.checkParameter(param.Name)).to.eventually.be.false;
    });
  });

  // Finds parameter
  it("deletes parameter", async () => {
    const param = {
      Name: "ssm-param-name"
    };

    ssmMock.on(DeleteParameterCommand).callsFake(input => {
      expect(input).to.eql({ Name: param.Name });
      return {};
    });

    return expect(parameterStore.deleteParameter(param.Name)).to.eventually.deep.equal(param.Name);
  });

});