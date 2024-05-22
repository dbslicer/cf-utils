# cf-utils - CloudFormation Utilities

Tools and utilities to enable infrastructure as code. Inspired by awslabs projects that use a combination of task runners,
cloud formation templates and sdk calls to reliably and repeatably deploy infrastructure.

While CloudFormation is comprehensive there are some areas that are painful or missing and these utilities aim to fill those
gaps. The rule of thumb (with one notable exception) is that if it can be done with CloudFormation templates then do so.
The exception is using lambdas defined in the template that run during cloud formation (e.g. to help describe stacks,
gather input or take actions via the AWS SDK). While this works it leaves the lambdas around after deployment and the can seriously clutter your infrastructure if you deploy dozens of stacks.

Otherwise these utilities encapsulate calling the AWS SDK directly from your task so that your cloud formation gets passed
all the parameters it needs or your infrastructure can be created directly yet still maintained as code.

## Latest Update

### v2.0.0

#### Changes

- AWS SDK updated to v3
- Removed unused dependencies and updated outdated.
- `config` module does not expose any AWS Client as of v2.0.0.
- A client configuration object has been made available through `config.AWS.clientConfig` for initialisation of Clients internally. This can also be used by consumers of `cf-utils` if they need the same configuration.

#### Breaking Change

Due to the fact that `cf-utils` no longer exposes the AWS SDK through the `config` module, consuming project will need to update their code to remove any instances of `new cfutils.config.AWS.{AWS_SERVICE}()`.

## Requirements

The code is written in javascript ECMAScript 6

## Installation

```sh
  npm install cf-utils
```

## AWS Credentials

The toolset is designed to use your aws profiles. However the default mode is for your to provide, via command line,
the name of the profile you wish to use for the deployment and the region you are targeting
(e.g.`--profile default --region us-east-1`).

## Usage

Include the toolset using

```javascript
  let cf = require('cf-utils');
```

The toolset is not designed to be opinionated so please be creative as you want with how you use these tools.
There is not a lot of code and while frowned upon you will find out more by looking at the source code than
what you will read here, so please dive in and have a look around.

But as for some guidance, essentially you

 1. Setup a base configuration
 2. Determine what parameters you intend to be provided via direct code or command line args
 3. Create CloudFormation templates
 4. Use the utilities to feed your cloud formation templates and/or deploy infrastructure.

### Configuration

The toolset includes a configuration object that not only stores your settings but also can help guard against
missing settings or force them to be provided via command line. The config object includes some convenience methods
for creating resource names in a consistent manner. In order for these methods to work your configuration must have the
following as a minimum:

```javascript
     PROJECT:         'Acme Toasters',
     PROJECT_VERSION: '0.1',
     PROJECT_PREFIX:  'acme-toasters-'
```

To apply your configuration call

```javascript
    cf.init({
      config: {
        // your configuration map
      }
    });
```

The configuration can also be setup with a schema for any configuration settings. These schemas help
provide better context to the caller when they are missing and you can indicate if the toolset should
look for the setting on the command line.

For example, this schema describes a config.IMAGE setting that can be provided via --image command line arg.

```javascript
    IMAGE: { description: 'Task docker image', argName: 'image' }
```

Here is a sample configuration setup:

```javascript
    cf.init({
      config: {
        PROJECT:         'Acme Toasters',
        PROJECT_VERSION: '0.1',
        PROJECT_PREFIX:  'acme-toasters-',

        STACK: {
          CORE: { name: 'core', script: 'templates/core-cf.yaml' },
          VPC:  { name: 'vpc',  script: 'templates/vpc-cf.yaml'  },
          VM:   { name: 'vm',   script: 'templates/vm-cf.yaml'   },
        },

        VPC: {
          AZS: {
            "us-east-1" : {
              AZ1: 'us-east-1a',
              AZ2: 'us-east-1c',
              AZ3: 'us-east-1e'
            }
          }
        }
      },

      schema: {
        EC2_AMI:  { description: 'EC2 AMI Image Id',  argName: 'ami' },
        EC2_TYPE: { description: 'EC2 Instance Type', argName: 'itype' }
      }
    })
```

### Creating Stacks

Everything centers on calling `cf.cloudFormation.upsertStack`. `upsertStack` will create the stack if it
does not already exist, update it if it does, provide a changeset for review if you request it and also
defer to the AWS CLI if your stack template contains transforms (i.e. SAM)

### Example Gulp Tasks

Perhaps the best way to describe what the toolset can do is with some examples.

```javascript
    let cf = require('cf-utils');
    cf.init(require('./config'));

    /**
     * Core stack tasks.
     */
    gulp.task('deploy_core_stack', function () {
      cf.logger.info('Creating core infrastructure...');
      return cf.cloudFormation.upsertStack(
        cf.config.getResourceName(cf.config.STACK.CORE.name),
        cf.config.STACK.CORE.script,
        [
          {ParameterKey: "ResourcePrefix",       ParameterValue: cf.config.getResourcePrefix()},
          {ParameterKey: "Project",              ParameterValue: cf.config.PROJECT},
          {ParameterKey: "ProjectVersion",       ParameterValue: cf.config.PROJECT_VERSION},
          {ParameterKey: "EnvironmentName",      ParameterValue: cf.config.ENVIRONMENT_STAGE}
        ]);
    });
    gulp.task('delete_core_stack', function () {
      cf.logger.info('Deleting core infrastructure...');
      return cf.cloudFormation.deleteStack(cf.config.getResourceName(cf.config.STACK.CORE.name));
    });


    /**
     * VPC stack for an organization (i.e. customer) tasks.
     */
    gulp.task('deploy_vpc_stack', function () {
      cf.logger.info('Creating VPC infrastructure for organization ' + cf.config.ORGANIZATION + '...');
      return cf.cloudFormation.upsertStack(
        cf.config.getOrgResourceName(cf.config.STACK.VPC.name),
        cf.config.STACK.VPC.script,
        [
          {ParameterKey: "ResourcePrefix",    ParameterValue: cf.config.getOrgResourcePrefix()},
          {ParameterKey: "Project",           ParameterValue: cf.config.PROJECT},
          {ParameterKey: "ProjectVersion",    ParameterValue: cf.config.PROJECT_VERSION},
          {ParameterKey: "ParameterPrefix",   ParameterValue: cf.config.getOrgParameterPrefix()},
          {ParameterKey: "EnvironmentName",   ParameterValue: cf.config.ENVIRONMENT_STAGE},
          {ParameterKey: "AvailabilityZone1", ParameterValue: cf.config.VPC.AZS[cf.config.AWS_REGION].AZ1},
          {ParameterKey: "AvailabilityZone2", ParameterValue: cf.config.VPC.AZS[cf.config.AWS_REGION].AZ2},
          {ParameterKey: "AvailabilityZone3", ParameterValue: cf.config.VPC.AZS[cf.config.AWS_REGION].AZ3}
      ]);
    });
    gulp.task('delete_vpc_stack', function () {
      cf.logger.info('Deleting VPC infrastructure...');
      return cf.cloudFormation.deleteStack(cf.config.getOrgResourceName(cf.config.STACK.VPC.name));
    });


    /**
     * VM stack tasks.
     */
    gulp.task('deploy_vm_stack', function() {
      cf.logger.info('Creating VM infrastructure...');
      return Promise
        .all([
          cf.cloudFormation.describeOutput(cf.config.getResourceName(cf.config.STACK.CORE.name)),
          cf.cloudFormation.describeOutput(cf.config.getOrgResourceName(cf.config.STACK.VPC.name))
        ])
        .then(([core, vpc]) =>
          cf.keypair
            .createKeyPair(
              cf.config.getOrgResourceName('vm-keypair'),
              core.InfrastructureBucket,
              'keypairs/' + cf.config.getOrgResourceName('vm-keypair') + '.pem'
            )
            .then(() =>
              cf.cloudFormation.upsertStack(
                cf.config.getOrgResourceName(cf.config.STACK.VM.name),
                cf.config.STACK.VM.script,
                [
                  {ParameterKey: "ResourcePrefix",       ParameterValue: cf.config.getOrgResourcePrefix()},
                  {ParameterKey: "Project",              ParameterValue: cf.config.PROJECT},
                  {ParameterKey: "ProjectVersion",       ParameterValue: cf.config.PROJECT_VERSION},
                  {ParameterKey: 'AvailabilityZone',     ParameterValue: cf.config.VPC.AZS[cf.config.AWS_REGION].AZ2},
                  {ParameterKey: 'AMIId',                ParameterValue: cf.config.EC2_AMI},
                  {ParameterKey: 'InstanceType',         ParameterValue: cf.config.EC2_TYPE},
                  {ParameterKey: 'VpcId',                ParameterValue: vpc.VpcId},
                  {ParameterKey: 'PublicSubnetId',       ParameterValue: vpc.PublicSubnetIdAZ2},
                  {ParameterKey: 'KeyPairName',          ParameterValue: cf.config.getOrgResourceName('vm-keypair')}
                ]
              )
            )
        );
    });
    gulp.task('delete_vm_stack', function () {
      cf.logger.info('Deleting VM infrastructure...');
      return Promise
        .all([
          cf.cloudFormation.describeOutput(cf.config.getResourceName(cf.config.STACK.CORE.name)),
        ])
        .then(([core]) =>
          cf.keypair.deleteKeyPair(
            cf.config.getOrgResourceName('vm-keypair'),
            core.InfrastructureBucket,
            'keypairs/' + cf.config.getOrgResourceName('vm-keypair') + '.pem')
        )
        .then(() =>
          cf.cloudFormation.deleteStack(cf.config.getOrgResourceName(cf.config.STACK.VM.name))
        );
    });


    /**
     * Lambda deployment tasks.
     */
    gulp.task('deploy_lambda_code', function () {
      cf.logger.info('Deploying lambda code...');
      return Promise
        .all([
          cf.cloudFormation.describeOutput(cf.config.getResourceName(cf.config.STACK.CORE.name)),
        ])
        .then(([core]) =>
          cf.s3.uploadDirectoryAsZipFile(
            core.InfrastructureBucket,
            cf.config.getLambdaZipS3Key(),
            cf.config.API.SOURCE_DIR,
            cf.config.API.PACKAGE_DIR,
            cf.config.getLambdaZipName()
          )
        );
    });
    gulp.task('update_lambda_functions', function () {
      cf.logger.info('Updating lambda functions...');
      return Promise
        .all([
          cf.cloudFormation.describeOutput(cf.config.getResourceName(cf.config.STACK.CORE.name)),
        ])
        .then(([core]) =>
          cf.lambda.updateFunctionsCode(
            cf.config.PROJECT_PREFIX,
            {
              S3Bucket: core.InfrastructureBucket,
              S3Key:    cf.config.getLambdaZipS3Key()
            }
          )
        );
    });
```

To deploy the VM stack one could call

```sh
  gulp deploy_vm_stack
    --profile default
    --region us-east-1
    --env dev
    --org widgetsandco
    --ami ami-12345
    --itype t2.micro
```
