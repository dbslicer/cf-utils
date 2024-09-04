const _chai = require("chai");
const expect = _chai.expect;
_chai.use(require('chai-as-promised'));
const rewire = require("rewire");
const { mockClient } = require("aws-sdk-client-mock");
const { mockConfig, mockS3, mockFs, mockSpawn } = require("./stubs");
const {
  CloudFormationClient,
  DescribeStacksCommand,
  CreateStackCommand,
  UpdateStackCommand,
  CreateChangeSetCommand,
  DeleteChangeSetCommand,
  DescribeChangeSetCommand,
  DeleteStackCommand
} = require('@aws-sdk/client-cloudformation');

// Rewire
const cloudFormation = rewire("../src/cloudFormation");
// Lower POLL_TIMEOUT for tests
cloudFormation.__set__("POLL_TIMEOUT", 0);

/**
 * Tests for spawn(cmd, args, options)
 * @param {any[]} args Values passed to spawn()
 * @param {string} name Expected stack same
 * @param {string} script Expected script location
 * @param {{ParameterKey: string, ParameterValue: string}[]} parameters Expected parameter overrides
 */
function expectMockSpawnConstructor(args, name, script, parameters) {
  expect(args).to.have.lengthOf(3);
  // cmd
  expect(args[0]).to.eql("aws");
  // args
  expect(args[1]).to.have.members([
    "cloudformation", "deploy",
    "--profile", mockConfig.AWS_PROFILE,
    "--region", mockConfig.AWS_REGION,
    "--template-file", script,
    "--stack-name", name,
    "--capabilities", "CAPABILITY_IAM", "CAPABILITY_NAMED_IAM",
    " --parameter-overrides", parameters.map((param => `${param.ParameterKey}="${param.ParameterValue}" `)).join("")
  ]);
  // options
  expect(args[2]).to.eql({ shell: true });
}

/**
 * Tests for stdout and stderr setEncoding()
 * @param {any[]} args Values passed to setEncoding()
 */
function expectMockSpawnEncoding(args) {
  expect(args).to.have.lengthOf(1);
  expect(args[0]).to.eql("utf8");
}

/**
 * Tests for a spawn function e.g. on("close", () => {})
 * @param {function} fn Function to call
 * @param {any} params Parameters to pass to function
 */
function expectMockSpawnFunctionCall(fn, params) {
  expect(typeof fn).to.eql("function");
  fn(params);
}

// cloudFormation Tests
describe("src/cloudFormation", () => {
  let stubs = [];

  // Mock cloudFormation Client
  let cfMock;

  beforeEach(() => {
    // Mock client
    cfMock = mockClient(CloudFormationClient);
    // Mock config
    const configRestore = cloudFormation.__set__("config", mockConfig);
    stubs.push({ restore: function () { return configRestore(); } });
    // Mock S3
    const s3Restore = cloudFormation.__set__("s3", mockS3);
    stubs.push({ restore: function () { return s3Restore(); } });
    // Mock 'fs'
    const fsRestore = cloudFormation.__set__("fs", mockFs.functions);
    stubs.push({ restore: function () { return fsRestore(); } });
  });

  afterEach(() => {
    // Reset mock
    cfMock.reset();
    stubs.forEach(stub => stub.restore());
  });

  // pollChangeSet
  describe("poll change set", () => {

    it("fails to describe change set", async () => {
      const params_not_exists = {
        ChangeSetName: "ChangeSetName_DoesNotExist", StackName: "StackName_DoesNotExist"
      };
      const params_error = {
        ChangeSetName: "ChangeSetName_Error", StackName: "StackName_Error"
      };

      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["ChangeSetName", "StackName"]);
        if (input.ChangeSetName.includes("DoesNotExist")) {
          expect(input).to.eql(params_not_exists);
          throw new Error("does not exist");
        } else {
          expect(input).to.eql(params_error);
          throw new Error("some other error");
        }
      });

      // Should not throw error
      await expect(cloudFormation.pollChangeSet(params_not_exists)).to.eventually.be.fulfilled;

      // Should throw error
      await expect(cloudFormation.pollChangeSet(params_error)).to.eventually.be.rejectedWith("some other error");
    });

    it("polls change set - created / updated / deleted", async () => {
      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["ChangeSetName", "StackName"]);
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: input.ChangeSetName,
        };
      });

      // CREATE_COMPLETE
      let res = await cloudFormation.pollChangeSet({ ChangeSetName: "CREATE_COMPLETE", StackName: "StackName" });
      expect(Object.keys(res)).to.have.members(["ChangeSetName", "StackName", "Status"]);
      expect(res.Status).to.eql("CREATE_COMPLETE");

      // UPDATE_COMPLETE
      res = await cloudFormation.pollChangeSet({ ChangeSetName: "UPDATE_COMPLETE", StackName: "StackName" });
      expect(Object.keys(res)).to.have.members(["ChangeSetName", "StackName", "Status"]);
      expect(res.Status).to.eql("UPDATE_COMPLETE");

      // DELETE_COMPLETE
      res = await cloudFormation.pollChangeSet({ ChangeSetName: "DELETE_COMPLETE", StackName: "StackName" })
      expect(Object.keys(res)).to.have.members(["ChangeSetName", "StackName", "Status"]);
      expect(res.Status).to.eql("DELETE_COMPLETE");
    });

    it("polls change set - failed", async () => {
      // Reasons for failure
      let reasons = [
        "No updates are to be performed",
        "didn't contain changes",
        "Some other creation error"
      ];

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["ChangeSetName", "StackName"]);
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: "FAILED",
          StatusReason: reasons.shift(),
        };
      });

      // FAILED - No updates are to be performed
      await expect(cloudFormation.pollChangeSet({ ChangeSetName: "ChangeSetName", StackName: "StackName" })).to.eventually.be.fulfilled;

      // FAILED - didn't contain changes
      await expect(cloudFormation.pollChangeSet({ ChangeSetName: "ChangeSetName", StackName: "StackName" })).to.eventually.be.fulfilled;

      // FAILED - Some other creation error
      await expect(cloudFormation.pollChangeSet({ ChangeSetName: "ChangeSetName", StackName: "StackName" })).to.eventually.be.rejectedWith("Changeset creation failed");
    });

    it("polls change set - recursive", async () => {
      // Statuses to cycle through
      let statuses = [
        "CREATE_PENDING",
        "CREATE_IN_PROGRESS",
        "FAILED",
      ];

      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["ChangeSetName", "StackName"]);
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: statuses.shift(),
          StatusReason: "No updates are to be performed",
        };
      });

      await expect(cloudFormation.pollChangeSet({ ChangeSetName: "ChangeSetName", StackName: "StackName" })).to.eventually.be.fulfilled;
      expect(statuses).to.have.lengthOf(0);
    });
  });

  // pollStack
  describe("poll stack", () => {

    it("fails to describe stack", async () => {
      const params_not_exists = { StackName: "StackName_DoesNotExist" };
      const params_error = { StackName: "StackName_Error" };

      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["StackName"]);
        if (input.StackName.includes("DoesNotExist")) {
          expect(input).to.eql(params_not_exists);
          throw new Error("does not exist");
        } else {
          expect(input).to.eql(params_error);
          throw new Error("some other error");
        }
      });

      // Should not throw error
      await expect(cloudFormation.pollStack(params_not_exists)).to.eventually.be.fulfilled;

      // Should throw error
      await expect(cloudFormation.pollStack(params_error)).to.eventually.be.rejectedWith("some other error");
    });

    it("polls stack - created / updated", async () => {
      // Statues
      let statuses = [
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE"
      ];

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["StackName"]);
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // CREATE_COMPLETE
      let res = await cloudFormation.pollStack({ StackName: "StackName1" });
      expect(Object.keys(res)).to.have.members(["Stacks"]);
      expect(res.Stacks).to.have.lengthOf(1);
      expect(res.Stacks[0]).to.eql({ StackName: "StackName1", StackStatus: "CREATE_COMPLETE" });

      // UPDATE_COMPLETE
      res = await cloudFormation.pollStack({ StackName: "StackName2" });
      expect(Object.keys(res)).to.have.members(["Stacks"]);
      expect(res.Stacks).to.have.lengthOf(1);
      expect(res.Stacks[0]).to.eql({ StackName: "StackName2", StackStatus: "UPDATE_COMPLETE" });

      // Expect all statuses to have been used
      expect(statuses).to.have.lengthOf(0);
    });

    it("polls stack - failed", async () => {
      // Statues
      let statuses = [
        "ROLLBACK_COMPLETE",
        "CREATE_FAILED",
        "UPDATE_FAILED",
        "DELETE_FAILED",
        "UPDATE_ROLLBACK_COMPLETE",
      ];

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["StackName"]);
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      for (let i = 0, length = statuses.length; i < length; i++) {
        await expect(cloudFormation.pollStack({ StackName: "StackName" })).to.eventually.be.rejectedWith("Stack operation failed");
      }

      // Expect all statuses to have been used
      expect(statuses).to.have.lengthOf(0);
    });

    it("polls stack - recursive", async () => {
      // Statues
      let statuses = [
        "CREATE_IN_PROGRESS",
        "DELETE_IN_PROGRESS",
        "UPDATE_IN_PROGRESS",
        "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS",
        "CREATE_COMPLETE",
      ];

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["StackName"]);
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      await expect(cloudFormation.pollStack({ StackName: "StackName" })).to.eventually.be.fulfilled;

      // Expect all statuses to have been used
      expect(statuses).to.have.lengthOf(0);
    });

  });

  // createStack
  describe("create stack", () => {

    it("creates stack", async () => {
      // Statues
      let statuses = [
        "CREATE_IN_PROGRESS",
        "CREATE_COMPLETE",
      ];

      const params = {
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: params.StackName });
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Mock CreateStackCommand
      cfMock.on(CreateStackCommand).callsFake(input => {
        expect(input).to.eql(Object.assign({ DisableRollback: true }, params));
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Create stack
      await expect(cloudFormation.createStack(params)).to.eventually.deep.equal(
        { Stacks: [{ StackName: params.StackName, StackStatus: "CREATE_COMPLETE" }] }
      );

      // Expect all statuses to have been used
      expect(statuses).to.have.lengthOf(0);
    });

    it("fails to create stack", async () => {
      // Statues
      let statuses = [
        "CREATE_IN_PROGRESS",
        "CREATE_FAILED",
      ];

      const params = {
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: params.StackName });
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Mock CreateStackCommand
      cfMock.on(CreateStackCommand).callsFake(input => {
        expect(input).to.eql(Object.assign({ DisableRollback: true }, params));
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Create stack - should fail
      await expect(cloudFormation.createStack(params)).to.eventually.be.rejectedWith("Stack operation failed");

      // Expect all statuses to have been used
      expect(statuses).to.have.lengthOf(0);
    });
  });

  // updateStack
  describe("update stack", () => {

    it("updates stack", async () => {
      // Statues
      let statuses = [
        "UPDATE_IN_PROGRESS",
        "UPDATE_COMPLETE",
      ];

      const params = {
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };

      // Mock UpdateStackCommand
      cfMock.on(UpdateStackCommand).callsFake(input => {
        expect(input).to.eql(params);
        return { StackId: `${params.StackName}-id`, }
      });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: params.StackName });
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Update stack
      await expect(cloudFormation.updateStack(params)).to.eventually.deep.equal(
        { Stacks: [{ StackName: params.StackName, StackStatus: "UPDATE_COMPLETE" }] }
      );

      expect(statuses).to.have.lengthOf(0);
    });

    it("fails to update stack - update failed", async () => {
      // Statues
      let statuses = [
        "UPDATE_IN_PROGRESS",
        "UPDATE_FAILED",
      ];

      const params = {
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };

      // Mock UpdateStackCommand
      cfMock.on(UpdateStackCommand).callsFake(input => {
        expect(input).to.eql(params);
        return { StackId: `${params.StackName}-id`, }
      });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: params.StackName });
        return {
          Stacks: [{
            StackName: input.StackName,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Update stack - should fail
      await expect(cloudFormation.updateStack(params)).to.eventually.be.rejectedWith("Stack operation failed");

      expect(statuses).to.have.lengthOf(0);
    });

    it("fails to update stack", async () => {
      let reasons = [
        "No updates are to be performed",
        "Other thrown error"
      ];

      const params = {
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };

      // Mock UpdateStackCommand
      cfMock.on(UpdateStackCommand).callsFake(input => {
        expect(input).to.eql(params);
        throw new Error(reasons.shift());
      });

      await expect(cloudFormation.updateStack(params)).to.eventually.be.fulfilled;
      await expect(cloudFormation.updateStack(params)).to.eventually.be.rejectedWith("Other thrown error");

      expect(reasons).to.have.lengthOf(0);
    });
  });

  // upsertStack
  describe("upsert stack", () => {

    it("fails to upsert stack - script does not exist", async () => {
      const name = "StackName";
      const script = "/path/to/DoesNotExist.yaml";
      const parameters = {
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };
      // review, s3Bucket, s3Prefix
      const options = {};

      return expect(cloudFormation.upsertStack(name, script, parameters, options)).to.eventually.be.rejectedWith(`${script} does not exist!`);
    });

    it("upserts stack - stack does not exist - create no transforms", async () => {
      const name = "StackName";
      const script = "/path/to/script.yaml";
      const stackInputs = {
        Parameter1: "Value1",
        Parameter2: "Value2",
      };
      // review, s3Bucket, s3Prefix
      const options = {};

      // Mock DescribeStacksCommand
      let describeFails = true; // Stack should not exists on first describe
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: name });

        if (describeFails) {
          describeFails = false;
          throw new Error("Some error thrown");
        }

        return {
          Stacks: [{
            StackName: name,
            StackStatus: "CREATE_COMPLETE",
          }]
        };
      });

      // Mock CreateStackCommand
      cfMock.on(CreateStackCommand).callsFake(input => {
        expect(input).to.eql({
          StackName: "StackName",
          Capabilities: [
            'CAPABILITY_IAM',
            'CAPABILITY_NAMED_IAM',
            'CAPABILITY_AUTO_EXPAND'
          ],
          Parameters: stackInputs,
          TemplateBody: script,
          DisableRollback: true
        });
        return {
          Stacks: [{
            StackName: name,
            StackStatus: "CREATE_COMPLETE",
          }]
        };
      });

      return expect(cloudFormation.upsertStack(name, script, stackInputs, options)).to.eventually.deep.equal(
        { Stacks: [{ StackName: name, StackStatus: "CREATE_COMPLETE" }] }
      );
    });

    it("upserts stack - stack does not exist - create with transforms ", async () => {
      const name = "StackName";
      const script = "/path/to/script-Transform.yaml";
      const stackInputs = {
        Parameter1: "Value1",
        Parameter2: "Value2",
      };
      // review, s3Bucket, s3Prefix
      const options = {};

      // Mock DescribeStacksCommand
      let describeFails = true; // Stack should not exists on first describe
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: name });

        if (describeFails) {
          describeFails = false;
          throw new Error("Some error thrown");
        }

        return {
          Stacks: [{
            StackName: name,
            StackStatus: "CREATE_COMPLETE",
          }]
        };
      });

      // Mock CreateChangeSetCommand
      cfMock.on(CreateChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["StackName", "Capabilities", "Parameters", "TemplateBody", "ChangeSetName", "ChangeSetType"]);
        expect(input.StackName).to.eql(name);
        expect(input.Capabilities).to.eql(['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']);
        expect(input.Parameters).to.eql(stackInputs);
        expect(input.TemplateBody).to.eql("Transform: \"AWS::Serverless\"");
        expect(input.ChangeSetName.startsWith("cf-utils-cloudformation-upsert-stack-")).to.be.true;
        expect(input.ChangeSetType).to.eql("CREATE");
        return { Id: "id", StackId: "StackId" };
      });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["ChangeSetName", "StackName"]);
        expect(input.ChangeSetName.startsWith("cf-utils-cloudformation-upsert-stack-")).to.be.true;
        expect(input.StackName).to.eql(name);
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: "CREATE_COMPLETE",
        };
      });

      return expect(cloudFormation.upsertStack(name, script, stackInputs, options)).to.eventually.deep.equal(
        { Stacks: [{ StackName: name, StackStatus: "CREATE_COMPLETE" }] }
      );
    });

    it("upserts stack - updating stack with transforms", async () => {
      const name = "StackName";
      const script = "/path/to/script-Transform.yaml";
      const stackInputs = {
        Parameter1: "Value1",
        Parameter2: "Value2",
      };
      // review, s3Bucket, s3Prefix
      const options = {};

      // Mock DescribeStacksCommand
      const statuses = [
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE"
      ];
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: name });
        return {
          Stacks: [{
            StackName: name,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Mock CreateChangeSetCommand
      cfMock.on(CreateChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["StackName", "Capabilities", "Parameters", "TemplateBody", "ChangeSetName", "ChangeSetType"]);
        expect(input.StackName).to.eql(name);
        expect(input.Capabilities).to.eql(['CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM', 'CAPABILITY_AUTO_EXPAND']);
        expect(input.Parameters).to.eql(stackInputs);
        expect(input.TemplateBody).to.eql("Transform: \"AWS::Serverless\"");
        expect(input.ChangeSetName.startsWith("cf-utils-cloudformation-upsert-stack-")).to.be.true;
        expect(input.ChangeSetType).to.eql("UPDATE");
        return { Id: "id", StackId: "StackId" };
      });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(Object.keys(input)).to.have.members(["ChangeSetName", "StackName"]);
        expect(input.ChangeSetName.startsWith("cf-utils-cloudformation-upsert-stack-")).to.be.true;
        expect(input.StackName).to.eql(name);
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: "UPDATE_COMPLETE",
        };
      });

      // Mock UpdateStackCommand
      cfMock.on(UpdateStackCommand).callsFake(input => {
        expect(input).to.eql({
          StackName: name,
          Capabilities: [
            'CAPABILITY_IAM',
            'CAPABILITY_NAMED_IAM',
            'CAPABILITY_AUTO_EXPAND'
          ],
          Parameters: stackInputs,
          TemplateBody: script
        });
        return { StackId: `${name}-id`, }
      });

      return expect(cloudFormation.upsertStack(name, script, stackInputs, options)).to.eventually.deep.equal(
        { Stacks: [{ StackName: name, StackStatus: "UPDATE_COMPLETE" }] }
      );
    });

    it("upserts stack - updating stack no transforms", async () => {
      const name = "StackName";
      const script = "/path/to/script.yaml";
      const stackInputs = {
        Parameter1: "Value1",
        Parameter2: "Value2",
      };
      // review, s3Bucket, s3Prefix
      const options = {};

      // Mock DescribeStacksCommand
      const statuses = [
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE"
      ];
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: name });
        return {
          Stacks: [{
            StackName: name,
            StackStatus: statuses.shift(),
          }]
        };
      });

      // Mock UpdateStackCommand
      cfMock.on(UpdateStackCommand).callsFake(input => {
        expect(input).to.eql({
          StackName: name,
          Capabilities: [
            'CAPABILITY_IAM',
            'CAPABILITY_NAMED_IAM',
            'CAPABILITY_AUTO_EXPAND'
          ],
          Parameters: stackInputs,
          TemplateBody: script
        });
        return { StackId: `${name}-id`, }
      });

      return expect(cloudFormation.upsertStack(name, script, stackInputs, options)).to.eventually.deep.equal(
        { Stacks: [{ StackName: name, StackStatus: "UPDATE_COMPLETE" }] }
      );
    });

    it("fails to upsert stack with review - user rejected", async () => {
      const name = "StackName";
      const script = "/path/to/script.yaml";
      const stackInputs = {
        Parameter1: "Value1",
        Parameter2: "Value2",
      };
      // review, s3Bucket, s3Prefix
      const options = {
        review: true
      };

      // Mock inquirer
      const mockInquirer = {
        prompt: async (_questions) => {
          return { performUpdate: false };
        }
      };
      const inquirerRestore = cloudFormation.__set__("inquirer", mockInquirer);
      stubs.push({ restore: function () { return inquirerRestore(); } });

      // Mock DescribeStacksCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: name });
        return {
          Stacks: [{
            StackName: name,
            StackStatus: "CREATE_COMPLETE",
          }]
        };
      });

      // Mock CreateChangeSetCommand
      cfMock.on(CreateChangeSetCommand).callsFake(input => {
        return { Id: "id", StackId: "StackId" };
      });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(input).to.eql({
          ChangeSetName: `cf-utils-${name}-preview`,
          StackName: name
        });
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: "CREATE_COMPLETE",
        };
      });

      return expect(cloudFormation.upsertStack(name, script, stackInputs, options)).to.eventually.be.rejectedWith("Reviewer rejected stack update");
    });

    it("upserts stack - with review", async () => {
      const name = "StackName";
      const script = "/path/to/script.yaml";
      const stackInputs = {
        Parameter1: "Value1",
        Parameter2: "Value2",
      };
      // review, s3Bucket, s3Prefix
      const options = {
        review: true
      };

      // Mock inquirer
      const mockInquirer = {
        prompt: async (_questions) => {
          return { performUpdate: true };
        }
      };
      const inquirerRestore = cloudFormation.__set__("inquirer", mockInquirer);
      stubs.push({ restore: function () { return inquirerRestore(); } });

      // Mock DescribeStacksCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: name });
        return {
          Stacks: [{
            StackName: name,
            StackStatus: "CREATE_COMPLETE",
          }]
        };
      });

      // Mock CreateChangeSetCommand
      cfMock.on(CreateChangeSetCommand).callsFake(input => {
        return { Id: "id", StackId: "StackId" };
      });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(input).to.eql({
          ChangeSetName: `cf-utils-${name}-preview`,
          StackName: name
        });
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: "CREATE_COMPLETE",
        };
      });

      // Mock DeleteChangeSetCommand
      cfMock.on(DeleteChangeSetCommand).callsFake(input => {
        expect(input).to.eql({ StackName: name, ChangeSetName: `cf-utils-${name}-preview` });
        return {};
      });

      // Mock UpdateStackCommand
      cfMock.on(UpdateStackCommand).callsFake(input => {
        expect(input).to.eql({
          StackName: name,
          Capabilities: [
            'CAPABILITY_IAM',
            'CAPABILITY_NAMED_IAM',
            'CAPABILITY_AUTO_EXPAND'
          ],
          Parameters: stackInputs,
          TemplateBody: script
        });
        return { StackId: `${name}-id`, }
      });

      return expect(cloudFormation.upsertStack(name, script, stackInputs, options)).to.eventually.deep.equal(
        { Stacks: [{ StackName: name, StackStatus: "CREATE_COMPLETE" }] }
      );
    });
  });

  // createChangeSet
  describe("create change set", () => {

    it("creates change set", async () => {
      // Statues
      let statuses = [
        "CREATE_IN_PROGRESS",
        "CREATE_COMPLETE",
      ];

      const params = {
        ChangeSetName: "ChangeSetName",
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(input).to.eql({ ChangeSetName: params.ChangeSetName, StackName: params.StackName });
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: statuses.shift(),
        };
      });

      // Mock CreateChangeSetCommand
      cfMock.on(CreateChangeSetCommand).callsFake(input => {
        expect(input).to.eql(params);
        return { Id: "id", StackId: "StackId" };
      });

      // Create change set
      await expect(cloudFormation.createChangeSet(params)).to.eventually.deep.equal({
        ChangeSetName: params.ChangeSetName,
        StackName: params.StackName,
        Status: "CREATE_COMPLETE",
      });

      expect(statuses).to.have.lengthOf(0);
    });

    it("fails to create change set", async () => {
      // Statues
      let statuses = [
        "CREATE_IN_PROGRESS",
        "FAILED",
      ];

      const params = {
        ChangeSetName: "ChangeSetName",
        StackName: "StackName",
        TemplateBody: "TemplateBody",
        TemplateURL: "TemplateURL",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(input).to.eql({ ChangeSetName: params.ChangeSetName, StackName: params.StackName });
        const statusReason = statuses[0] === "FAILED" ? { StatusReason: "Some other error" } : {};
        return Object.assign({},
          {
            ChangeSetName: input.ChangeSetName,
            StackName: input.StackName,
            Status: statuses.shift(),
          },
          statusReason
        );
      });

      // Mock CreateChangeSetCommand
      cfMock.on(CreateChangeSetCommand).callsFake(input => {
        expect(input).to.eql(params);
        return { Id: "id", StackId: "StackId" };
      });

      // Create change set
      await expect(cloudFormation.createChangeSet(params)).to.eventually.be.rejectedWith("Changeset creation failed");

      expect(statuses).to.have.lengthOf(0);
    });
  });

  // deleteChangeSet
  describe("delete change set", () => {
    it("deletes change set", async () => {
      const statuses = [
        "DELETE_IN_PROGRESS",
        "DELETE_COMPLETE"
      ];
      const params = {
        ChangeSetName: "ChangeSetName",
        StackName: "StackName",
      };

      // Mock DeleteChangeSetCommand
      cfMock.on(DeleteChangeSetCommand).callsFake(input => {
        expect(input).to.eql(params);
        return {};
      });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeChangeSetCommand).callsFake(input => {
        expect(input).to.eql(params);
        return {
          ChangeSetName: input.ChangeSetName,
          StackName: input.StackName,
          Status: statuses.shift(),
        };
      });

      await expect(cloudFormation.deleteChangeSet(params)).to.eventually.deep.equal({
        ChangeSetName: params.ChangeSetName,
        StackName: params.StackName,
        Status: "DELETE_COMPLETE",
      });

      expect(statuses).to.have.lengthOf(0);
    });
  });

  // deployStack
  describe("deploy stack", () => {

    it("deploys stack", async () => {
      const name = "StackName";
      const script = "location/of/StackName.yaml";
      const parameters = [
        { ParameterKey: "ParameterKey", ParameterValue: "ParameterValue" }
      ];

      // Mock spawn for this test
      // Callback function to test spawn params and calls
      const mockSpawnCallback = (event, args) => {
        // expect events to be mocked
        expect(["constructor", "stdout.encoding", "stderr.encoding", "on.close", "stdout.on.data", "stderr.on.data"]).to.include(event, `'${event}' not mocked for 'spawn()'`);

        // Handle events
        if (event === "constructor") {
          expectMockSpawnConstructor(args, name, script, parameters);
        } else if (event === "stdout.encoding" || event === "stderr.encoding") {
          expectMockSpawnEncoding(args);
        } else if (event === "on.close") {
          expectMockSpawnFunctionCall(args[0], 0);
        }
      };
      const spawnRestore = cloudFormation.__set__("spawn", mockSpawn(mockSpawnCallback).spawn);
      stubs.push({ restore: function () { return spawnRestore(); } });

      const expected = {
        StackName: name,
        StackStatus: "DELETE_COMPLETE",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: expected.StackName });
        return { Stacks: [expected] };
      });

      // Deploy stack
      return expect(cloudFormation.deployStack(name, script, parameters)).to.eventually.deep.equal(expected);
    });

    it("deploys stack - no changes to deploy", async () => {
      // mock console.log for this test to ignore output
      const consoleLogRestore = cloudFormation.__set__("console.log", () => { });
      stubs.push({ restore: function () { return consoleLogRestore(); } });

      // Params
      const name = "StackName";
      const script = "location/of/StackName.yaml";
      const parameters = [
        { ParameterKey: "ParameterKey", ParameterValue: "ParameterValue" }
      ];

      // Mock spawn for this test
      // Callback function to test spawn params and calls
      const mockSpawnCallback = (event, args) => {
        // expect events to be mocked
        expect(["constructor", "stdout.encoding", "stderr.encoding", "on.close", "stdout.on.data", "stderr.on.data"]).to.include(event, `'${event}' not mocked for 'spawn()'`);

        // Handle events
        if (event === "constructor") {
          expectMockSpawnConstructor(args, name, script, parameters);
        } else if (event === "stdout.encoding" || event === "stderr.encoding") {
          expectMockSpawnEncoding(args);
        } else if (event === "on.close") {
          expectMockSpawnFunctionCall(args[0], 1);
        } else if (event === "stderr.on.data") {
          expectMockSpawnFunctionCall(args[0], "No changes to deploy");
        }
      };
      const spawnRestore = cloudFormation.__set__("spawn", mockSpawn(mockSpawnCallback).spawn);
      stubs.push({ restore: function () { return spawnRestore(); } });

      const expected = {
        StackName: name,
        StackStatus: "DELETE_COMPLETE",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: expected.StackName });
        return { Stacks: [expected] };
      });

      // Deploy stack
      return expect(cloudFormation.deployStack(name, script, parameters)).to.eventually.deep.equal(expected);
    });

    it("fails to deploys stack - aws cli", async () => {
      // mock console.log for this test to ignore output
      const consoleLogRestore = cloudFormation.__set__("console.log", () => { });
      stubs.push({ restore: function () { return consoleLogRestore(); } });

      const name = "StackName";
      const script = "location/of/StackName.yaml";
      const parameters = [
        { ParameterKey: "ParameterKey", ParameterValue: "ParameterValue" }
      ];

      // Mock spawn for this test
      // Callback function to test spawn params and calls
      const mockSpawnCallback = (event, args) => {
        // expect events to be mocked
        expect(["constructor", "stdout.encoding", "stderr.encoding", "on.close", "stdout.on.data", "stderr.on.data"]).to.include(event, `'${event}' not mocked for 'spawn()'`);

        // Handle events
        if (event === "constructor") {
          expectMockSpawnConstructor(args, name, script, parameters);
        } else if (event === "stdout.encoding" || event === "stderr.encoding") {
          expectMockSpawnEncoding(args);
        } else if (event === "on.close") {
          expectMockSpawnFunctionCall(args[0], 1);
        } else if (event === "stderr.on.data") {
          expectMockSpawnFunctionCall(args[0], "Ignore: Some testing error");
        }
      };
      const spawnRestore = cloudFormation.__set__("spawn", mockSpawn(mockSpawnCallback).spawn);
      stubs.push({ restore: function () { return spawnRestore(); } });

      // Deploy stack
      return expect(cloudFormation.deployStack(name, script, parameters)).to.eventually.be.rejectedWith("Stack deploy failed");
    });

    it("fails to deploy stack - describe stack", async () => {
      const name = "StackName";
      const script = "location/of/StackName.yaml";
      const parameters = [
        { ParameterKey: "ParameterKey", ParameterValue: "ParameterValue" }
      ];

      // Mock spawn for this test
      const mockSpawnCallback = (event, args) => {
        // expect events to be mocked
        expect(["constructor", "stdout.encoding", "stderr.encoding", "on.close", "stdout.on.data", "stderr.on.data"]).to.include(event, `'${event}' not mocked for 'spawn()'`);

        // Handle events
        if (event === "on.close") {
          expectMockSpawnFunctionCall(args[0], 0);
        }
      };
      const spawnRestore = cloudFormation.__set__("spawn", mockSpawn(mockSpawnCallback).spawn);
      stubs.push({ restore: function () { return spawnRestore(); } });

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: "StackName" });
        throw new Error("some other error");
      });

      return expect(cloudFormation.deployStack(name, script, parameters)).to.eventually.be.rejectedWith("some other error");
    });
  });

  // describeStack
  describe("describe stack", () => {

    it("describes stack", async () => {
      const expected = {
        StackName: "StackName",
        StackStatus: "DELETE_COMPLETE",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: expected.StackName });
        return { Stacks: [expected] };
      });

      await expect(cloudFormation.describeStack(expected.StackName)).to.eventually.deep.equal(expected);
    });

    it("fails to describe stack", async () => {
      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: "StackName" });
        throw new Error("some other error");
      });

      return expect(cloudFormation.describeStack("StackName")).to.eventually.be.rejectedWith("some other error");
    });
  });

  // describeOutput
  describe("describe output", () => {

    it("describes output", async () => {
      const expected = {
        Property1: "Value1",
        Property2: "Value2",
        Property3: "Value3",
      };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql({ StackName: "StackName" });
        return {
          Stacks: [{
            StackName: "StackName",
            StackStatus: "DELETE_COMPLETE",
            Outputs: [
              { OutputKey: "Property1", OutputValue: "Value1" },
              { OutputKey: "Property2", OutputValue: "Value2" },
              { OutputKey: "Property3", OutputValue: "Value3" },
            ]
          }]
        };
      });

      await expect(cloudFormation.describeOutput("StackName")).to.eventually.deep.equal(expected);
    });
  });

  // extractOutput
  describe("extract output", () => {
    it("extracts output", async () => {
      const stack = {
        Outputs: [
          { OutputKey: "Property1", OutputValue: "Value1" },
          { OutputKey: "Property2", OutputValue: "Value2" },
          { OutputKey: "Property3", OutputValue: "Value3" },
        ]
      };

      const extracted = cloudFormation.extractOutput(stack);
      expect(extracted).to.eql({
        Property1: "Value1",
        Property2: "Value2",
        Property3: "Value3",
      })
    });
  });

  // deleteStack
  describe("delete stack", () => {

    it("deletes stack", async () => {
      let statuses = [
        "CREATE_COMPLETE",
        "DELETE_IN_PROGRESS"
      ];

      const params = { StackName: "StackName" };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        // does not exist
        expect(input).to.eql(params);

        // Stack has been deleted if no statues remain
        if (statuses.length === 0) {
          throw new Error("does not exist");
        }

        // Otherwise return the next status
        return {
          Stacks: [{
            StackName: "StackName",
            StackStatus: statuses.shift(),
            Outputs: [
              { OutputKey: "Property1", OutputValue: "Value1" },
              { OutputKey: "Property2", OutputValue: "Value2" },
            ]
          }]
        };
      });

      // Mock DeleteStackCommand
      cfMock.on(DeleteStackCommand).callsFake(input => {
        expect(input).to.eql(params);
        return {};
      });

      await expect(cloudFormation.deleteStack(params.StackName)).to.eventually.be.fulfilled;

      expect(statuses).to.have.lengthOf(0);
    });

    it("deletes stack and empties bucket", async () => {
      let statuses = [
        "CREATE_COMPLETE",
        "DELETE_IN_PROGRESS"
      ];

      const params = { StackName: "StackName" };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        // does not exist
        expect(input).to.eql(params);

        // Stack has been deleted if no statues remain
        if (statuses.length === 0) {
          throw new Error("does not exist");
        }

        // Otherwise return the next status
        return {
          Stacks: [{
            StackName: "StackName",
            StackStatus: statuses.shift(),
            Outputs: [
              { OutputKey: "Property1", OutputValue: "Value1" },
              { OutputKey: "Property2", OutputValue: "Value2" },
              { OutputKey: "EmptyBucket", OutputValue: "bucket-name" },
            ]
          }]
        };
      });

      // Mock DeleteStackCommand
      cfMock.on(DeleteStackCommand).callsFake(input => {
        expect(input).to.eql(params);
        return {};
      });

      await expect(cloudFormation.deleteStack(params.StackName)).to.eventually.be.fulfilled;

      expect(statuses).to.have.lengthOf(0);
    });

    it("stack already deleted", async () => {
      const params = { StackName: "StackName" };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql(params);
        throw new Error("does not exist");
      });

      return expect(cloudFormation.deleteStack(params.StackName)).to.eventually.be.fulfilled;
    });

    it("fails to delete stack when describing", async () => {
      const params = { StackName: "StackName" };

      // Mock DescribeChangeSetCommand
      cfMock.on(DescribeStacksCommand).callsFake(input => {
        expect(input).to.eql(params);
        throw new Error("some other error");
      });

      return expect(cloudFormation.deleteStack(params.StackName)).to.eventually.be.rejectedWith("some other error");
    });
  });

});